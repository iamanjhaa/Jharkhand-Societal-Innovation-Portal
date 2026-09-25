'use client'

import { useEffect, useMemo, useState } from 'react'
import { BookOpen, CheckCircle2, ClipboardList, FolderKanban, Search, Users, X } from 'lucide-react'
import {
  assignChallengeMentor, downloadChallengeAttachment, getChallenges, getDepartmentChallengeMentors, getDepartmentMembers, getProjects,
  createProject, getProjectById, getSolutionRecommendations, updateProjectProgress, updateProjectSolution, updateProjectTeam,
} from '@/lib/api'

export type DepartmentSection = 'problems' | 'project' | 'progress' | 'library' | 'profile'
type User = { _id?: string; name?: string; email?: string; institution?: string; universityDepartment?: string; accountType?: string; primaryClub?: string | null }
type Challenge = NonNullable<Awaited<ReturnType<typeof getChallenges>>['data']>[number]
type Project = NonNullable<Awaited<ReturnType<typeof getProjects>>['data']>[number]
type RecommendationSolution = NonNullable<Awaited<ReturnType<typeof getSolutionRecommendations>>['data']>['recommendations'][number]['solution']

const sections: { key: DepartmentSection; label: string }[] = [
  { key: 'problems', label: 'Assigned Problems' },
  { key: 'project', label: 'Project' },
  { key: 'progress', label: 'Progress' },
  { key: 'library', label: 'Solution Library' },
  { key: 'profile', label: 'Profile' },
]
const stageProgress: Record<string, number> = { proposed: 0, prototype: 25, testing: 50, deployed: 75, completed: 100 }

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'green' | 'amber' | 'blue' }) {
  const colors = { slate: 'bg-slate-100 text-slate-600', green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-800', blue: 'bg-blue-50 text-blue-700' }
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${colors[tone]}`}>{children}</span>
}

function date(value?: string) {
  return value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
}

function hasAccountType(member: { accountType?: string }, accountType: 'student' | 'researcher') {
  return member.accountType?.trim().toLowerCase() === accountType
}

function Card({ title, eyebrow, children }: { title: string; eyebrow?: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    {eyebrow && <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-red-600">{eyebrow}</p>}
    <h2 className="mt-1 text-lg font-bold text-slate-950">{title}</h2>
    <div className="mt-5">{children}</div>
  </section>
}

function ChallengeDetails({ challenge, projects, onClose }: { challenge: Challenge; projects: Project[]; onClose: () => void }) {
  const project = projects.find((item) => item.challenge?._id === challenge._id)
  const fields: [string, unknown][] = [
    ['Challenge ID', challenge._id], ['Category', challenge.category], ['District', challenge.district],
    ['Location', challenge.villageOrCity], ['Urgency', challenge.urgency], ['Government priority', challenge.priority],
    ['University acceptance', challenge.assignmentStatus], ['Department', challenge.department],
    ['Faculty mentor', challenge.departmentMentor?.name], ['Industry funding', challenge.industryFundingStatus],
    ['Project status', project?.status], ['Created', date(challenge.createdAt)],
  ]
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
    <div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-wider text-red-600">Assigned problem</p><h2 className="mt-1 text-xl font-bold text-slate-950">{challenge.title}</h2></div><button onClick={onClose} aria-label="Close details"><X className="size-5 text-slate-500" /></button></div>
      <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-slate-700">{challenge.description}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-800">{value ? String(value) : 'Not available'}</p></div>)}</div>
      <div className="mt-5"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Evidence</p>{challenge.attachments?.length ? <div className="mt-2 space-y-2">{challenge.attachments.map((attachment) => <button key={attachment._id} onClick={() => void downloadChallengeAttachment(challenge._id, attachment._id, attachment.originalName)} className="block w-full rounded-lg bg-slate-50 p-2 text-left text-sm font-semibold text-blue-700">{attachment.originalName}</button>)}</div> : <p className="mt-2 text-sm text-slate-500">No evidence files available.</p>}</div>
    </div>
  </div>
}

export default function DepartmentDashboard({ user, section = 'problems', onSectionChange }: { user: User; section?: DepartmentSection; onSectionChange?: (section: DepartmentSection) => void }) {
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [members, setMembers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Challenge | null>(null)
  const [teamProject, setTeamProject] = useState<Project | null>(null)
  const [createTarget, setCreateTarget] = useState<Challenge | null>(null)
  const [mentorTarget, setMentorTarget] = useState<Challenge | null>(null)
  const [mentors, setMentors] = useState<User[]>([])
  const [studentSelection, setStudentSelection] = useState<string[]>([])
  const [researcherSelection, setResearcherSelection] = useState<string[]>([])
  const [projectForm, setProjectForm] = useState({ title: '', objective: '', description: '', technology: '' })
  const [progressProject, setProgressProject] = useState<Project | null>(null)
  const [progressForm, setProgressForm] = useState({ currentStage: 'proposed' })
  const [teamSelection, setTeamSelection] = useState<string[]>([])
  const [solutionProject, setSolutionProject] = useState<Project | null>(null)
  const [solution, setSolution] = useState({ solutionTitle: '', solutionDescription: '', solutionApproach: '', technology: '', implementationDetails: '', expectedOutcome: '' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<'success' | 'error'>('success')
  const [recommendationChallenge, setRecommendationChallenge] = useState<Challenge | null>(null)
  const [recommendations, setRecommendations] = useState<Awaited<ReturnType<typeof getSolutionRecommendations>>['data']>(undefined)
  const [recommendationBusy, setRecommendationBusy] = useState(false)
  const [selectedRecommendation, setSelectedRecommendation] = useState<RecommendationSolution | null>(null)

  async function refresh() {
    setLoading(true)
    try {
      const [challengeResponse, projectResponse, memberResponse] = await Promise.all([getChallenges(), getProjects(), getDepartmentMembers()])
      const failed = [challengeResponse, projectResponse, memberResponse].find((response) => !response.success)
      if (failed) {
        setChallenges([])
        setProjects([])
        setMembers([])
        setError(failed.message || 'Unable to load department workspace')
        return
      }
      setError('')
      setChallenges(challengeResponse.data || [])
      setProjects(projectResponse.data || [])
      setMembers(memberResponse.data || [])
    } catch (error) {
      setChallenges([])
      setProjects([])
      setMembers([])
      setError(error instanceof Error ? error.message : 'Unable to load department workspace')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    document.getElementById(`department-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [section])

  const visibleChallenges = useMemo(() => challenges.filter((challenge) => `${challenge.title} ${challenge.category} ${challenge.district}`.toLowerCase().includes(search.toLowerCase())), [challenges, search])
  const mentor = challenges.find((challenge) => challenge.departmentMentor)?.departmentMentor
  const eligibleMembers = members.filter((member) => hasAccountType(member, 'student') || hasAccountType(member, 'researcher'))
  const eligibleStudents = eligibleMembers.filter((member) => hasAccountType(member, 'student'))
  const eligibleResearchers = eligibleMembers.filter((member) => hasAccountType(member, 'researcher'))
  const libraryProjects = projects.filter((project) => project.solutionStatus === 'submitted' && (project.status === 'deployed' || project.status === 'completed'))
  const stageLabels = ['proposed', 'prototype', 'testing', 'deployed', 'completed']

  async function saveTeam() {
    if (!teamProject || busy) return
    setBusy(true)
    try {
      const response = await updateProjectTeam(teamProject._id, teamSelection)
      setNoticeTone(response.success ? 'success' : 'error')
      setNotice(response.success ? 'Project team updated.' : `Failed to create project team: ${response.message || 'Unable to update project team.'}`)
      if (response.success) { setTeamProject(null); await refresh() }
    } catch (error) {
      setNoticeTone('error')
      setNotice(`Failed to create project team: ${error instanceof Error ? error.message : 'Unable to update project team.'}`)
    } finally {
      setBusy(false)
    }
  }

  async function saveProject() {
    if (!createTarget || busy) return
    const title = projectForm.title.trim()
    const objective = projectForm.objective.trim()
    const description = projectForm.description.trim()
    if (!title || !objective || !description) {
      setNoticeTone('error')
      setNotice('Project title, objective, and description are required.')
      return
    }
    if (!studentSelection.length || !researcherSelection.length) {
      setNoticeTone('error')
      setNotice('Select at least one Student and one Researcher before creating a project.')
      return
    }
    const assignedMentor = createTarget.departmentMentor?._id
    if (!assignedMentor) { setNoticeTone('error'); return setNotice('A faculty mentor must be assigned before creating a project.') }
    setBusy(true)
    try {
      const response = await createProject({
        title,
        description,
        challenge: createTarget._id,
        universityDepartment: createTarget.department || user.universityDepartment || '',
        facultyMentor: assignedMentor,
        projectType: 'multidisciplinary_project',
        solutionSummary: objective,
        expectedImpact: objective,
        teamMembers: [...studentSelection, ...researcherSelection],
        estimatedBudget: 0,
        timeline: { startDate: new Date().toISOString().slice(0, 10), expectedCompletionDate: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10) },
      })
      setNoticeTone(response.success ? 'success' : 'error')
      setNotice(response.success ? 'Project created successfully.' : response.message || 'Unable to create project.')
      if (response.success) {
        setCreateTarget(null)
        setProjectForm({ title: '', objective: '', description: '', technology: '' })
        setStudentSelection([])
        setResearcherSelection([])
        await refresh()
      }
    } catch (error) {
      console.error('Project creation failed', error)
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : 'Unable to create project.')
    } finally {
      setBusy(false)
    }
  }

  async function openMentorSelection(challenge: Challenge) {
    setMentorTarget(challenge)
    const response = await getDepartmentChallengeMentors(challenge._id)
    if (response.success) setMentors(response.data || [])
    else { setNoticeTone('error'); setNotice(response.message || 'Unable to load eligible faculty mentors.') }
  }

  async function selectMentor(mentorId: string) {
    if (!mentorTarget || busy) return
    setBusy(true)
    const response = await assignChallengeMentor(mentorTarget._id, mentorId)
    setNoticeTone(response.success ? 'success' : 'error')
    setNotice(response.success ? 'Faculty mentor assigned successfully.' : response.message || 'Unable to assign faculty mentor.')
    if (response.success) { setMentorTarget(null); await refresh() }
    setBusy(false)
  }

  async function saveProgress() {
    if (!progressProject || busy) return
    const stageIndex = stageLabels.indexOf(progressProject.currentStage || 'proposed')
    const nextStage = stageLabels[stageIndex + 1]
    if (!nextStage || progressForm.currentStage !== nextStage) {
      setNoticeTone('error')
      setNotice('The project can only move to its next stage.')
      return
    }
    setBusy(true)
    try {
      const response = await updateProjectProgress(progressProject._id, progressForm.currentStage)
      setNoticeTone(response.success ? 'success' : 'error')
      setNotice(response.success ? `Project moved to ${progressForm.currentStage}.` : response.message || 'Unable to update project progress.')
      if (response.success) { setProgressProject(null); await refresh() }
    } catch (error) {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : 'Unable to update project progress.')
    } finally {
      setBusy(false)
    }
  }

  async function openProgress(project: Project) {
    const response = await getProjectById(project._id)
    if (!response.success || !response.data) {
      setNoticeTone('error')
      setNotice(response.message || 'Unable to load the latest project data.')
      return
    }
    const latestProject = response.data
    const currentStage = stageLabels.includes(latestProject.currentStage || '') ? latestProject.currentStage || 'proposed' : 'proposed'
    const currentStageIndex = stageLabels.indexOf(currentStage)
    const nextStage = stageLabels[currentStageIndex + 1] || currentStage
    setProgressProject(latestProject)
    setProgressForm({ currentStage: nextStage })
  }

  async function saveSolution(status: 'draft' | 'submitted') {
    if (!solutionProject || busy) return
    const solutionTitle = solution.solutionTitle.trim()
    const solutionDescription = solution.solutionDescription.trim()
    const solutionApproach = solution.solutionApproach.trim()
    const expectedOutcome = solution.expectedOutcome.trim()
    if (status === 'submitted' && (!solutionTitle || !solutionDescription || !solutionApproach || !expectedOutcome)) {
      setNoticeTone('error')
      setNotice('Solution title, proposed solution, approach, and expected outcome are required before submission.')
      return
    }
    setBusy(true)
    try {
      const response = await updateProjectSolution(solutionProject._id, {
        ...solution,
        solutionTitle,
        solutionDescription,
        solutionApproach,
        expectedOutcome,
        solutionStatus: status,
      })
      setNoticeTone(response.success ? 'success' : 'error')
      setNotice(response.success
        ? status === 'submitted' ? 'Solution saved successfully.' : 'Solution draft saved.'
        : response.message || 'Unable to save solution.')
      if (response.success) {
        setSolutionProject(null)
        await refresh()
      }
    } catch (error) {
      console.error('Solution save failed', error)
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : 'Unable to save solution.')
    } finally {
      setBusy(false)
    }
  }

  async function findRecommendations(challenge: Challenge) {
    if (recommendationBusy) return
    setRecommendationChallenge(challenge)
    setRecommendations(undefined)
    setRecommendationBusy(true)
    const response = await getSolutionRecommendations(challenge._id)
    setRecommendationBusy(false)
    if (response.success) setRecommendations(response.data)
    else {
      setNoticeTone('error')
      setNotice(response.message || 'AI recommendations are temporarily unavailable. You can browse the Solution Library manually.')
    }
  }

  function openSolution(project: Project) {
    setSolutionProject(project)
    setSolution({
      solutionTitle: project.solutionTitle || '', solutionDescription: project.solutionDescription || '',
      solutionApproach: project.solutionApproach || '', technology: project.technology || '',
      implementationDetails: project.implementationDetails || '', expectedOutcome: project.expectedOutcome || '',
    })
  }

  if (loading) return <main className="min-h-full bg-slate-50 p-5 sm:p-8"><div className="mx-auto max-w-7xl rounded-2xl border border-slate-200 bg-white p-12 text-center"><p className="font-bold text-slate-800">Loading department workspace...</p></div></main>
  if (error) return <main className="min-h-full bg-slate-50 p-5 sm:p-8"><div className="mx-auto max-w-7xl rounded-2xl border border-red-200 bg-red-50 p-12 text-center"><p className="font-bold text-red-800">{error}</p><button onClick={() => void refresh()} className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white">Retry</button></div></main>

  return <main className="min-h-full bg-slate-50 p-5 sm:p-8"><div className="mx-auto max-w-[1350px]">
    <header className="rounded-2xl bg-[#06245C] p-6 text-white shadow-lg sm:p-8"><p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-200">Department workspace</p><h1 className="mt-2 text-3xl font-bold">{user.universityDepartment || 'University Department'}</h1><p className="mt-3 text-sm text-blue-100">{user.institution || 'University'} · Problem, team and solution execution.</p></header>
    {notice && <div className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${noticeTone === 'error' ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{notice}</div>}
    <div className="mt-6 grid gap-3 sm:grid-cols-5">{sections.map(({ key, label }) => <button key={key} onClick={() => onSectionChange?.(key)} className={`rounded-xl border px-3 py-3 text-left text-sm font-bold ${section === key ? 'border-blue-700 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-700'}`}>{label}</button>)}</div>
    <div id="department-problems" className="mt-6"><Card eyebrow="Coordinator-routed work" title="Assigned Problems"><div className="relative"><Search className="absolute left-3 top-3 size-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search problems" className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm" /></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400"><tr><th className="pb-3 pr-4">Problem</th><th className="pb-3 pr-4">Urgency</th><th className="pb-3 pr-4">Mentor</th><th className="pb-3 pr-4">Funding</th><th className="pb-3">Created</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleChallenges.map((challenge) => <tr key={challenge._id} onClick={() => setSelected(challenge)} className="cursor-pointer hover:bg-slate-50"><td className="py-4 pr-4"><p className="font-bold text-blue-800">{challenge.title}</p><p className="mt-1 text-xs text-slate-500">{challenge.category} · {challenge.district}</p><button onClick={(event) => { event.stopPropagation(); void findRecommendations(challenge) }} className="mt-2 rounded-md border border-violet-200 px-2 py-1 text-xs font-bold text-violet-800">Find AI Solutions</button></td><td className="py-4 pr-4"><Badge tone={challenge.urgency === 'HIGH' || challenge.urgency === 'CRITICAL' ? 'amber' : 'slate'}>{challenge.urgency || challenge.priority}</Badge></td>    <td className="py-4 pr-4 text-slate-600">{challenge.departmentMentor ? <><span>{challenge.departmentMentor.name}</span><span className="block text-xs text-emerald-700">Assigned</span></> : <button onClick={(event) => { event.stopPropagation(); void openMentorSelection(challenge) }} className="rounded-md border border-blue-200 px-2 py-1 text-xs font-bold text-blue-800">Select Mentor</button>}</td>    <td className="py-4 pr-4 text-slate-600">{challenge.industryFundingStatus || 'Not recorded'}{challenge.industryFundingStatus && !['accepted', 'proposal_accepted', 'funded'].includes(challenge.industryFundingStatus) && <span className="ml-2 text-xs font-bold text-amber-700">Waiting for Industry Funding Approval</span>}</td><td className="py-4 text-slate-500">{date(challenge.createdAt)}{!projects.some((project) => project.challenge?._id === challenge._id) && <button disabled={!challenge.departmentMentor || !['accepted', 'proposal_accepted', 'funded'].includes(challenge.industryFundingStatus || '')} onClick={(event) => { event.stopPropagation(); setCreateTarget(challenge) }} className="mt-2 block rounded-md bg-[#06245C] px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">Create Project</button>}</td></tr>)}</tbody></table>{!visibleChallenges.length && <p className="py-8 text-center text-sm text-slate-500">No problems are assigned to this department.</p>}</div></Card></div>
    <div id="department-project" className="mt-6"><Card eyebrow="Mentor-led execution" title="Project"><div className="space-y-3">{projects.map((project) => <article key={project._id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{project.title}</h3><p className="mt-1 text-sm text-slate-600">{project.challenge?.title || 'Linked problem unavailable'} · {project.facultyMentor?.name || 'Mentor not assigned'}</p></div><Badge tone="blue">{project.status.replaceAll('_', ' ')}</Badge></div><dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2"><div><dt className="font-bold text-slate-400">Objective</dt><dd>{project.solutionSummary || 'Not provided'}</dd></div><div><dt className="font-bold text-slate-400">Department</dt><dd>{project.universityDepartment || 'Not provided'}</dd></div><div><dt className="font-bold text-slate-400">Funding</dt><dd>{project.challenge?.industryFundingStatus || 'Not recorded'}{project.challenge?.industryFundingAmount ? ` · ₹${project.challenge.industryFundingAmount.toLocaleString('en-IN')}` : ''}</dd></div><div><dt className="font-bold text-slate-400">Team</dt><dd>{project.teamMembers?.length || 0} members: {project.teamMembers?.map((member) => member.name).filter(Boolean).join(', ') || 'None'}</dd></div></dl>{project.facultyMentor?._id === user._id && <button onClick={() => { setTeamProject(project); setTeamSelection((project.teamMembers || []).map((member) => member._id).filter((id): id is string => Boolean(id))) }} className="mt-4 rounded-md bg-[#06245C] px-3 py-2 text-xs font-bold text-white">Build project team</button>}<button onClick={() => openProgress(project)} className="ml-2 mt-4 rounded-md border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">Update progress</button>{project.facultyMentor?._id === user._id && <button onClick={() => openSolution(project)} className="ml-2 mt-4 rounded-md border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-800">Edit solution</button>}</article>)}{!projects.length && <p className="text-sm text-slate-500">Create a project after Industry funding is approved.</p>}</div></Card></div>
    <div id="department-progress" className="mt-6"><Card eyebrow="Stage-based lifecycle" title="Project Progress"><div className="space-y-5">{projects.map((project) => { const currentStage = stageLabels.includes(project.currentStage || '') ? project.currentStage || 'proposed' : 'proposed'; const currentIndex = stageLabels.indexOf(currentStage); const derivedProgress = stageProgress[currentStage]; return <article key={project._id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><p className="font-bold text-slate-900">{project.title}</p><span className="text-sm font-bold text-blue-800">{currentStage} · {derivedProgress}%</span></div>{currentStage === 'completed' && <p className="mt-2 text-sm font-bold text-emerald-700">Work Finished / Project Completed</p>}<div className="mt-3 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-blue-700 transition-all" style={{ width: `${derivedProgress}%` }} /></div><div className="mt-5 space-y-3">{stageLabels.map((stage, index) => { const complete = index <= currentIndex; return <div key={stage} className="flex items-start gap-3 text-sm"><span className={`mt-0.5 text-base font-bold ${complete ? 'text-emerald-600' : 'text-slate-400'}`}>{complete ? '✓' : '○'}</span><div><p className="font-semibold capitalize text-slate-800">{stage}</p><p className="text-xs text-slate-500">{complete ? 'Completed' : 'Pending'}</p></div></div>})}</div></article> })}{!projects.length && <p className="text-sm text-slate-500">Progress appears after a funded project is created.</p>}</div></Card></div><div id="department-library" className="mt-6"><Card eyebrow="Reusable knowledge" title="Solution Library"><p className="text-sm text-slate-600">Only submitted solutions attached to deployed or completed projects appear here. Select an assigned problem to find potentially reusable verified approaches.</p><div className="mt-4 grid gap-3 md:grid-cols-2">{libraryProjects.map((project) => <article key={project._id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{project.solutionTitle || project.title}</h3><p className="mt-1 text-xs text-slate-500">{project.challenge?.category} · {project.universityDepartment}</p></div><Badge tone="green">Verified lifecycle stage</Badge></div><p className="mt-3 text-sm text-slate-600">{project.solutionDescription || 'Solution description not provided.'}</p><p className="mt-3 text-xs text-slate-500">Technology: {project.technology || 'Not recorded'}</p></article>)}{!libraryProjects.length && <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center"><BookOpen className="mx-auto size-6 text-slate-400" /><p className="mt-2 text-sm font-bold text-slate-700">No solutions are eligible for the library yet.</p><p className="mt-1 text-xs text-slate-500">Complete the existing deployment and verification workflow first.</p></div>}</div></Card></div>
    <div id="department-profile" className="mt-6"><Card eyebrow="Authorized account" title="Profile"><div className="grid gap-3 sm:grid-cols-2">{[['Name', user.name], ['Email', user.email], ['University', user.institution], ['Department', user.universityDepartment], ['Account type', user.accountType], ['Permission', 'University department access']].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-sm font-semibold text-slate-800">{value || 'Not available'}</p></div>)}</div></Card></div>
    {selected && <ChallengeDetails challenge={selected} projects={projects} onClose={() => setSelected(null)} />}
    {recommendationChallenge && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-wider text-violet-700">AI Recommended</p><h2 className="mt-1 text-xl font-bold text-slate-950">AI Solution Recommendations</h2><p className="mt-2 text-sm text-slate-600">AI searched previously verified solutions for potentially reusable approaches. Review before reuse.</p></div><button onClick={() => setRecommendationChallenge(null)} aria-label="Close recommendations"><X className="size-5 text-slate-500" /></button></div>{recommendationBusy ? <p className="mt-6 text-sm font-semibold text-slate-600">Finding relevant solutions...</p> : !recommendations ? <p className="mt-6 text-sm text-red-700">AI recommendations are temporarily unavailable. You can browse the Solution Library manually.</p> : !recommendations.recommendations.length ? <p className="mt-6 text-sm text-slate-600">No verified previous solution was found for this problem yet.</p> : <div className="mt-6 space-y-4">{recommendations.recommendations.map((recommendation) => <article key={recommendation.solutionId} className="rounded-xl border border-violet-100 bg-violet-50/40 p-4"><h3 className="font-bold text-slate-900">{recommendation.solution.solutionTitle || recommendation.solution.title}</h3><p className="mt-1 text-sm text-slate-600">Original problem: {recommendation.solution.challenge?.title || 'Verified societal problem'}</p><p className="mt-3 text-sm text-slate-700">{recommendation.reason}</p><p className="mt-2 text-xs text-slate-500">Technology: {recommendation.solution.technology || 'Not recorded'} · Outcome: {recommendation.solution.expectedOutcome || 'Not recorded'}</p><div className="mt-3 flex flex-wrap gap-2">{recommendation.relevantAspects.map((aspect) => <Badge key={aspect} tone="blue">{aspect}</Badge>)}</div><button onClick={() => setSelectedRecommendation(recommendation.solution)} className="mt-4 rounded-md bg-[#06245C] px-3 py-2 text-xs font-bold text-white">View Solution</button></article>)}</div>}</div></div>}
    {selectedRecommendation && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Verified Solution Library item</p><h2 className="mt-1 text-xl font-bold text-slate-950">{selectedRecommendation.solutionTitle || selectedRecommendation.title}</h2></div><button onClick={() => setSelectedRecommendation(null)} aria-label="Close solution details"><X className="size-5 text-slate-500" /></button></div><div className="mt-5 space-y-3 text-sm text-slate-700"><p><strong>Original problem:</strong> {selectedRecommendation.challenge?.title || 'Not available'}</p><p><strong>Problem description:</strong> {selectedRecommendation.challenge?.description || 'Not available'}</p><p><strong>Solution approach:</strong> {selectedRecommendation.solutionApproach || 'Not recorded'}</p><p><strong>Technology used:</strong> {selectedRecommendation.technology || 'Not recorded'}</p><p><strong>Implementation details:</strong> {selectedRecommendation.implementationDetails || 'Not recorded'}</p><p><strong>Result/outcome:</strong> {selectedRecommendation.expectedOutcome || 'Not recorded'}</p><p><strong>Verification status:</strong> Government verified completed solution</p></div></div></div>}
    {mentorTarget && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex justify-between"><div><p className="text-[11px] font-bold uppercase tracking-wider text-red-600">Faculty mentor</p><h2 className="mt-1 text-lg font-bold text-slate-950">Select Mentor</h2><p className="mt-1 text-sm text-slate-500">{mentorTarget.department} · {mentorTarget.title}</p></div><button onClick={() => setMentorTarget(null)} aria-label="Close mentor selection"><X className="size-5 text-slate-500" /></button></div><div className="mt-5 space-y-2">{mentors.map((mentor) => <button key={mentor._id} disabled={busy} onClick={() => void selectMentor(mentor._id || '')} className="flex w-full items-start justify-between rounded-xl border border-slate-200 p-3 text-left hover:border-blue-500 disabled:opacity-50"><span><span className="block font-bold text-slate-800">{mentor.name}</span><span className="block text-xs text-slate-500">Faculty · {mentor.universityDepartment} · {mentor.institution}</span></span></button>)}{!mentors.length && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No eligible faculty mentors are available in this department.</p>}</div></div></div>}
    {createTarget && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex justify-between"><div><p className="text-[11px] font-bold uppercase tracking-wider text-red-600">Funding Approved</p><h2 className="mt-1 text-lg font-bold text-slate-950">Create Project</h2></div><button onClick={() => setCreateTarget(null)} aria-label="Close project form"><X className="size-5 text-slate-500" /></button></div><p className="mt-2 text-sm text-slate-500">{createTarget.title} · Mentor: {createTarget.departmentMentor?.name}</p><div className="mt-5 space-y-3">{([['title', 'Project title'], ['objective', 'Project objective'], ['description', 'Project description']] as const).map(([key, label]) => <label key={key} className="block text-sm font-semibold text-slate-700">{label}<textarea value={projectForm[key]} onChange={(event) => setProjectForm((current) => ({ ...current, [key]: event.target.value }))} rows={key === 'title' ? 1 : 3} className="mt-1 w-full rounded-lg border border-slate-200 p-3 text-sm font-normal" /></label>)}<div><p className="text-sm font-bold text-slate-700">Students</p>{eligibleStudents.map((member) => <label key={member._id} className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={studentSelection.includes(member._id || '')} onChange={(event) => setStudentSelection((current) => event.target.checked ? [...current, member._id || ''] : current.filter((id) => id !== member._id))} />{member.name} <span className="text-xs text-slate-500">· {member.universityDepartment || 'University student'}</span></label>)}</div><div><p className="text-sm font-bold text-slate-700">Researchers</p>{eligibleResearchers.map((member) => <label key={member._id} className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={researcherSelection.includes(member._id || '')} onChange={(event) => setResearcherSelection((current) => event.target.checked ? [...current, member._id || ''] : current.filter((id) => id !== member._id))} />{member.name} <span className="text-xs text-slate-500">· Researcher</span></label>)}</div>{(!studentSelection.length || !researcherSelection.length) && <p className="text-sm font-semibold text-red-700">Select at least one Student and one Researcher to create this project.</p>}</div><button disabled={busy || !projectForm.title || !projectForm.objective || !projectForm.description || !studentSelection.length || !researcherSelection.length} onClick={() => void saveProject()} className="mt-5 w-full rounded-lg bg-[#06245C] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Creating...' : 'Create Project'}</button></div></div>}
        {progressProject && (() => {
      const currentStageIndex = stageLabels.indexOf(progressProject.currentStage || 'proposed')
      const nextStage = stageLabels[currentStageIndex + 1]
      const isCompleted = !nextStage
      return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex justify-between"><div><h2 className="text-lg font-bold text-slate-950">Update Progress</h2><p className="mt-1 text-sm text-slate-500">Current stage: {progressProject.currentStage || 'proposed'}</p></div><button onClick={() => setProgressProject(null)} aria-label="Close progress form"><X className="size-5 text-slate-500" /></button></div>{isCompleted ? <p className="mt-6 rounded-lg bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Project Completed</p> : <><label className="mt-5 block text-sm font-semibold text-slate-700">Current stage<select value={progressForm.currentStage} onChange={(event) => setProgressForm({ currentStage: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-3 text-sm"><option value={nextStage}>{nextStage}</option></select></label><button disabled={busy} onClick={() => void saveProgress()} className="mt-5 w-full rounded-lg bg-[#06245C] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Updating...' : 'Update Progress'}</button></>}</div></div>
    })()}{teamProject && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex justify-between"><div><p className="text-[11px] font-bold uppercase tracking-wider text-red-600">Assigned mentor</p><h2 className="mt-1 text-lg font-bold text-slate-950">Create project team</h2></div><button onClick={() => setTeamProject(null)} aria-label="Close team editor"><X className="size-5 text-slate-500" /></button></div><p className="mt-2 text-sm text-slate-500">{teamProject.title}</p><div className="mt-5 max-h-72 space-y-2 overflow-y-auto">{eligibleMembers.map((member) => <label key={member._id} className="flex items-center gap-3 rounded-lg border border-slate-100 p-3"><input type="checkbox" checked={teamSelection.includes(member._id || '')} onChange={(event) => setTeamSelection((current) => event.target.checked ? [...new Set([...current, member._id].filter(Boolean) as string[])] : current.filter((id) => id !== member._id))} /><span><span className="block text-sm font-semibold text-slate-800">{member.name}</span><span className="block text-xs text-slate-500">{member.accountType} · {member.email}</span></span></label>)}</div><button disabled={busy} onClick={() => void saveTeam()} className="mt-5 w-full rounded-lg bg-[#06245C] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving...' : 'Create Project Team'}</button></div></div>}
    {solutionProject && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><div role="dialog" aria-modal="true" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex justify-between"><div><p className="text-[11px] font-bold uppercase tracking-wider text-red-600">Solution development</p><h2 className="mt-1 text-lg font-bold text-slate-950">{solutionProject.title}</h2></div><button onClick={() => setSolutionProject(null)} aria-label="Close solution editor"><X className="size-5 text-slate-500" /></button></div><div className="mt-5 grid gap-3">{([['solutionTitle', 'Solution title'], ['solutionDescription', 'Proposed solution'], ['solutionApproach', 'Solution approach'], ['technology', 'Technology / methodology'], ['implementationDetails', 'Implementation details'], ['expectedOutcome', 'Expected outcome']] as const).map(([key, label]) => <label key={key} className="text-sm font-semibold text-slate-700">{label}<textarea value={solution[key]} onChange={(event) => setSolution((current) => ({ ...current, [key]: event.target.value }))} rows={key === 'solutionTitle' ? 2 : 3} className="mt-1 w-full rounded-lg border border-slate-200 p-3 text-sm font-normal" /></label>)}</div><div className="mt-5 flex flex-wrap gap-2"><button disabled={busy} onClick={() => void saveSolution('draft')} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700">Save draft</button><button disabled={busy} onClick={() => void saveSolution('submitted')} className="rounded-lg bg-[#06245C] px-4 py-2.5 text-sm font-bold text-white">Submit solution</button></div></div></div>}
  </div></main>
}
