'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Bell, Building2, CheckCircle2, ChevronRight, CircleDollarSign, ClipboardList,
  FileText, LayoutDashboard, Search, ShieldCheck, Target, UserRound, Users, X,
} from 'lucide-react'
import {
  acceptChallenge, acceptUniversitySponsorship, assignChallengeDepartment, assignSankalpDepartment,
  getChallenges, getProjects, getUniversityMembers, getUniversitySponsorships,
  rejectUniversitySponsorship, downloadChallengeAttachment, getSankalpMentors, registerSankalpMentor,
} from '@/lib/api'
import { UNIVERSITY_ASSIGNMENT_DEPARTMENTS } from '@/lib/university-departments'

export type CoordinatorSection = 'dashboard' | 'problems' | 'departments' | 'mentors' | 'proposals' | 'projects' | 'impact' | 'notifications' | 'profile'
type Challenge = NonNullable<Awaited<ReturnType<typeof getChallenges>>['data']>[number]
type Project = NonNullable<Awaited<ReturnType<typeof getProjects>>['data']>[number]
type Sponsorship = NonNullable<Awaited<ReturnType<typeof getUniversitySponsorships>>['data']>[number]
type User = { _id?: string; name?: string; email?: string; role?: string; institution?: string; universityDepartment?: string; accountType?: string; universityRole?: string; sankalpClubProfile?: { club?: string; role?: string; active?: boolean } }

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' }) {
  const styles = { slate: 'bg-slate-100 text-slate-600', green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-800', red: 'bg-red-50 text-red-700', blue: 'bg-blue-50 text-blue-700' }
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${styles[tone]}`}>{children}</span>
}

function SectionCard({ title, eyebrow, children, action }: { title: string; eyebrow?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="mb-5 flex items-start justify-between gap-4"><div>{eyebrow && <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-red-600">{eyebrow}</p>}<h2 className="mt-1 text-lg font-bold text-slate-950">{title}</h2></div>{action}</div>{children}</section>
}

function formatDate(value?: string) { return value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' }
function challengeStatus(challenge: Challenge) {
  if (challenge.cancelledAt) return ['Cancelled', 'red'] as const
  if (challenge.departmentMentor) return ['Mentor assigned', 'green'] as const
  if (challenge.department) return ['Department assigned', 'blue'] as const
  if (challenge.assignmentStatus === 'accepted') return ['Awaiting department', 'amber'] as const
  return ['Awaiting acceptance', 'amber'] as const
}
function projectStatus(project: Project) { return project.status.replaceAll('_', ' ') }

function ChallengeModal({ challenge, onClose }: { challenge: Challenge; onClose: () => void }) {
  const fields: [string, unknown][] = [
    ['Description', challenge.description], ['Category', challenge.category], ['District', challenge.district],
    ['Location', challenge.villageOrCity], ['AI urgency', challenge.urgency], ['Urgency reason', challenge.urgencyReason],
    ['Priority', challenge.priority], ['Affected people', challenge.affected], ['Expected impact', challenge.expectedImpact],
    ['Submission date', formatDate(challenge.createdAt)], ['Acceptance', challenge.assignmentStatus],
    ['Department', challenge.department], ['Mentor', challenge.departmentMentor?.name],
    ['Funding status', challenge.industryFundingStatus], ['Funding amount', challenge.industryFundingAmount ? `₹${challenge.industryFundingAmount.toLocaleString('en-IN')}` : '—'],
  ]
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-wider text-red-600">Government problem</p><h2 className="mt-1 text-xl font-bold text-slate-950">{challenge.title}</h2></div><button onClick={onClose} aria-label="Close problem details" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="size-5" /></button></div><div className="mt-6 grid gap-3 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 break-words whitespace-pre-wrap text-sm font-semibold text-slate-800">{value === undefined || value === null || value === '' ? 'Not available' : String(value)}</p></div>)}</div><div className="mt-5 rounded-xl border border-slate-200 p-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Citizen evidence</p>{challenge.attachments?.length ? <div className="mt-3 space-y-2">{challenge.attachments.map((attachment) => <button key={attachment._id} onClick={() => void downloadChallengeAttachment(challenge._id, attachment._id, attachment.originalName)} className="flex w-full justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-left text-sm font-semibold text-blue-700 hover:bg-blue-50"><span className="break-all">{attachment.originalName}</span><span className="shrink-0 text-xs text-slate-500">Download</span></button>)}</div> : <p className="mt-2 text-sm text-slate-500">No evidence files attached.</p>}</div><button onClick={onClose} className="mt-6 w-full rounded-lg bg-[#06245C] px-4 py-3 text-sm font-bold text-white">Close</button></div></div>
}

export default function UniversityCoordinatorDashboard({ user, section = 'dashboard', onSectionChange }: { user: User; section?: CoordinatorSection; onSectionChange?: (section: CoordinatorSection) => void }) {
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [sponsorships, setSponsorships] = useState<Sponsorship[]>([])
  const [members, setMembers] = useState<NonNullable<Awaited<ReturnType<typeof getUniversityMembers>>['data']>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ category: '', district: '', urgency: '', status: '', department: '', funding: '' })
  const [departmentTarget, setDepartmentTarget] = useState<Challenge | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const [selectedSankalpMentor, setSelectedSankalpMentor] = useState('')
  const [sankalpMentors, setSankalpMentors] = useState<NonNullable<Awaited<ReturnType<typeof getSankalpMentors>>['data']>>([])
  const [loadingSankalpMentors, setLoadingSankalpMentors] = useState(false)
  const [sankalpMentorError, setSankalpMentorError] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success')

  async function refresh() {
    setLoading(true); setError('')
    try {
      const results = await Promise.all([getChallenges(), getProjects(), getUniversitySponsorships(), getUniversityMembers()])
      const failed = results.find((result) => !result.success)
      if (failed) {
        setChallenges([])
        setProjects([])
        setSponsorships([])
        setMembers([])
        setError(failed.message || 'Unable to load coordinator data')
        return
      }
      setChallenges(results[0].data || [])
      setProjects(results[1].data || [])
      setSponsorships(results[2].data || [])
      setMembers(results[3].data || [])
    } catch (error) {
      setChallenges([])
      setProjects([])
      setSponsorships([])
      setMembers([])
      setError(error instanceof Error ? error.message : 'Unable to load coordinator data')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refresh() }, [])

  async function loadSankalpMentors() {
    setLoadingSankalpMentors(true)
    setSankalpMentorError('')
    const response = await getSankalpMentors()
    if (!response.success) {
      setSankalpMentors([])
      setSankalpMentorError(response.message || 'Unable to load Sankalp Club mentors')
    } else {
      setSankalpMentors(response.data || [])
    }
    setLoadingSankalpMentors(false)
  }

  async function designateSankalpMentor(mentorId: string) {
    if (busy) return
    setBusy('Register Sankalp mentor')
    setMessage('')
    const response = await registerSankalpMentor(mentorId)
    setMessageTone(response.success ? 'success' : 'error')
    setMessage(response.message || (response.success ? 'Sankalp Club mentor registered.' : 'Unable to register Sankalp Club mentor.'))
    if (response.success) {
      await refresh()
      await loadSankalpMentors()
    }
    setBusy('')
  }

  function chooseDepartment(department: string) {
    setSelectedDepartment(department)
    setSelectedSankalpMentor('')
    setSankalpMentorError('')
    if (department === 'Sankalp Club') void loadSankalpMentors()
  }

  const filteredChallenges = useMemo(() => challenges.filter((challenge) => {
    const haystack = `${challenge.title} ${challenge.description} ${challenge.category} ${challenge.district}`.toLowerCase()
    return (!search || haystack.includes(search.toLowerCase()))
      && (!filters.category || challenge.category === filters.category)
      && (!filters.district || challenge.district === filters.district)
      && (!filters.urgency || challenge.urgency === filters.urgency)
      && (!filters.status || challengeStatus(challenge)[0] === filters.status)
      && (!filters.department || (challenge.department || 'Unassigned') === filters.department)
      && (!filters.funding || (challenge.industryFundingStatus || 'not_required') === filters.funding)
  }), [challenges, filters, search])
  const pendingAcceptance = challenges.filter((item) => item.assignmentStatus !== 'accepted' && !item.cancelledAt).length
  const pendingDepartment = challenges.filter((item) => item.assignmentStatus === 'accepted' && !item.department).length
  const pendingMentor = challenges.filter((item) => item.department && !item.departmentMentor).length
  const activeProjects = projects.filter((item) => !['completed', 'deployed', 'rejected'].includes(item.status)).length
  const completedProjects = projects.filter((item) => item.status === 'completed' || item.status === 'deployed').length
  const proposalReview = sponsorships.filter((item) => ['pending', 'approved'].includes(item.status)).length
  const stats: { label: string; value: number; icon: typeof FileText }[] = [
    { label: 'Problems received', value: challenges.length, icon: FileText },
    { label: 'Pending acceptance', value: pendingAcceptance, icon: ShieldCheck },
    { label: 'Department assignment', value: pendingDepartment, icon: Building2 },
    { label: 'Mentor assignment', value: pendingMentor, icon: Users },
    { label: 'Industry proposals', value: sponsorships.length, icon: CircleDollarSign },
    { label: 'Active projects', value: activeProjects, icon: Target },
  ]

  async function action(label: string, callback: () => Promise<{ success: boolean; message?: string }>) {
    if (busy) return
    setBusy(label)
    setMessage('')
    try {
      const response = await callback()
      if (!response.success) {
        setMessageTone('error')
        setMessage(response.message || `Unable to ${label.toLowerCase()}`)
      } else {
        setMessageTone('success')
        setMessage(`${label} completed`)
        await refresh()
      }
    } catch (error) {
      setMessageTone('error')
      setMessage(error instanceof Error ? error.message : `Unable to ${label.toLowerCase()}`)
    } finally {
      setBusy('')
    }
  }
  const categories = [...new Set(challenges.map((item) => item.category).filter(Boolean))]
  const districts = [...new Set(challenges.map((item) => item.district).filter(Boolean))]
  const statuses = [...new Set(challenges.map((item) => challengeStatus(item)[0]))]
  const departments = [...new Set(challenges.map((item) => item.department || 'Unassigned'))]

  if (loading) return <main className="min-h-full bg-slate-50 p-5 sm:p-8"><div className="mx-auto max-w-7xl rounded-2xl border border-slate-200 bg-white p-12 text-center"><p className="font-bold text-slate-800">Loading coordinator dashboard...</p><p className="mt-1 text-sm text-slate-500">Fetching institution data.</p></div></main>
  if (error) return <main className="min-h-full bg-slate-50 p-5 sm:p-8"><div className="mx-auto max-w-7xl rounded-2xl border border-red-200 bg-red-50 p-12 text-center"><p className="font-bold text-red-800">Unable to load coordinator data</p><p className="mt-1 text-sm text-red-700">{error}</p><button onClick={() => void refresh()} className="mt-5 rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white">Retry</button></div></main>

  return <main className="min-h-full bg-slate-50 p-5 sm:p-8"><div className="mx-auto max-w-[1450px]"><div className="rounded-2xl bg-[#06245C] p-6 text-white shadow-lg sm:p-8"><p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-200">University Innovation Office</p><h1 className="mt-2 text-3xl font-bold sm:text-4xl">Coordinator workspace</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-blue-100">Coordinate verified government problems from acceptance through departments, mentors, funding and measurable solutions.</p><div className="mt-5 flex flex-wrap gap-3"><Badge tone="blue">{user.institution || 'University'}</Badge><Badge tone="green">Authorized coordinator</Badge></div></div>
    {message && <div className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${messageTone === 'error' ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{message}</div>}
    <div className="mt-6">
      {section === 'dashboard' && <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">{stats.map(({ label, value, icon: Icon }) => <button key={label} onClick={() => onSectionChange?.(label === 'Industry proposals' ? 'proposals' : label === 'Active projects' ? 'projects' : 'problems')} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-slate-500">{label}</p><span className="grid size-9 place-items-center rounded-lg bg-blue-50 text-blue-700"><Icon className="size-4" /></span></div><p className="mt-3 text-3xl font-bold text-slate-950">{value}</p></button>)}</div><div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]"><SectionCard eyebrow="Needs attention" title="Pending actions"><div className="space-y-2">{[['Problem acceptance', pendingAcceptance], ['Department assignment', pendingDepartment], ['Mentor assignment', pendingMentor], ['Funding proposal review', proposalReview]].map(([label, count]) => <button key={String(label)} onClick={() => onSectionChange?.(label === 'Funding proposal review' ? 'proposals' : 'problems')} className="flex w-full items-center justify-between rounded-xl border border-slate-100 p-3 text-left hover:bg-slate-50"><span className="text-sm font-semibold text-slate-700">{label}</span><span className="flex items-center gap-2"><Badge tone={Number(count) ? 'amber' : 'green'}>{count ? `${count} pending` : 'Clear'}</Badge><ChevronRight className="size-4 text-slate-400" /></span></button>)}</div></SectionCard><SectionCard eyebrow="Latest" title="Recent government problems" action={<button onClick={() => onSectionChange?.('problems')} className="text-xs font-bold text-blue-700">View all</button>}><div className="space-y-3">{challenges.slice(0, 4).map((challenge) => { const [status, tone] = challengeStatus(challenge); return <button key={challenge._id} onClick={() => setSelectedChallenge(challenge)} className="w-full rounded-xl border border-slate-100 p-3 text-left hover:bg-slate-50"><div className="flex items-start justify-between gap-3"><span className="min-w-0 font-bold text-slate-800">{challenge.title}</span><Badge tone={tone}>{status}</Badge></div><p className="mt-1 text-xs text-slate-500">{challenge.category} · {challenge.district} · {formatDate(challenge.createdAt)}</p></button> })}{!challenges.length && <p className="text-sm text-slate-500">No Government problems have been assigned to this institution.</p>}</div></SectionCard></div></>}
      {section === 'problems' && <SectionCard eyebrow="Government workflow" title="Assigned Government problems"><div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6"><label className="relative md:col-span-3 xl:col-span-2"><Search className="absolute left-3 top-3 size-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search problems" className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500" /></label>{Object.entries({ category: categories, district: districts, urgency: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], status: statuses, department: departments, funding: ['proposal_pending', 'proposal_accepted', 'funded', 'not_required'] }).map(([key, values]) => <select key={key} value={filters[key as keyof typeof filters]} onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold capitalize text-slate-700"><option value="">{key}</option>{values.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select>)}</div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400"><tr><th className="pb-3 pr-4">Problem</th><th className="pb-3 pr-4">Location</th><th className="pb-3 pr-4">Urgency</th><th className="pb-3 pr-4">Status</th><th className="pb-3 pr-4">Department</th><th className="pb-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredChallenges.map((challenge) => { const [status, tone] = challengeStatus(challenge); const canAccept = challenge.assignmentStatus !== 'accepted' && !challenge.cancelledAt; const canDepartment = challenge.assignmentStatus === 'accepted' && !challenge.department;       return <tr key={challenge._id}><td className="py-4 pr-4"><button onClick={() => setSelectedChallenge(challenge)} className="font-bold text-blue-800 hover:underline">{challenge.title}</button><p className="mt-1 text-xs text-slate-500">{challenge.category}</p></td><td className="py-4 pr-4 text-slate-600">{challenge.district}<br /><span className="text-xs">{challenge.villageOrCity || 'Location unavailable'}</span></td><td className="py-4 pr-4"><Badge tone={challenge.urgency === 'CRITICAL' || challenge.urgency === 'HIGH' ? 'red' : 'amber'}>{challenge.urgency || challenge.priority}</Badge></td><td className="py-4 pr-4"><Badge tone={tone}>{status}</Badge></td><td className="py-4 pr-4 text-slate-600">{challenge.department || 'Unassigned'}</td><td className="py-4"><div className="flex flex-wrap gap-2">{canAccept && <button disabled={busy === 'Accept problem'} onClick={() => void action('Accept problem', () => acceptChallenge(challenge._id))} className="rounded-md bg-[#06245C] px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50">{busy === 'Accept problem' ? 'Accepting...' : 'Accept'}</button>}{canDepartment && <button onClick={() => setDepartmentTarget(challenge)} className="rounded-md bg-blue-700 px-2.5 py-1.5 text-xs font-bold text-white">Assign department</button>      }<button onClick={() => setSelectedChallenge(challenge)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700">View</button></div></td></tr> })}</tbody></table>{!filteredChallenges.length && <p className="py-10 text-center text-sm text-slate-500">No problems match the selected filters.</p>}</div></SectionCard>}
      {section === 'departments' && <SectionCard eyebrow="Institutional routing" title="Departments"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{UNIVERSITY_ASSIGNMENT_DEPARTMENTS.map((department) => { const count = challenges.filter((item) => item.department === department).length; return <article key={department} className={`rounded-xl border p-4 ${department === 'Sankalp Club' ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200'}`}><div className="flex items-start justify-between gap-3"><Building2 className="size-5 text-blue-700" /><Badge tone={count ? 'blue' : 'slate'}>{count} {count === 1 ? 'problem' : 'problems'}</Badge></div><h3 className="mt-4 font-bold text-slate-900">{department}</h3><p className="mt-1 text-xs text-slate-500">{department === 'Sankalp Club' ? 'Special NCC cadet and NSS volunteer workflow.' : 'Assignments are managed by the University Coordinator.'}</p></article> })}</div></SectionCard>}
      {section === 'mentors' && <SectionCard eyebrow="Eligible university users" title="Faculty & mentors"><p className="mb-4 text-sm text-slate-600">Sankalp Club mentors are real faculty accounts designated by this University coordinator.</p><div className="grid gap-3 md:grid-cols-2">{members.filter((member) => member.accountType === 'faculty').map((member) => { const isSankalpMentor = member.sankalpClubProfile?.club === 'Sankalp Club' && member.sankalpClubProfile.role === 'Sankalp Club Mentor' && member.sankalpClubProfile.active; return <article key={member._id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{member.name}</h3><p className="mt-1 text-xs text-slate-500">{member.universityDepartment || 'Department unavailable'} · {member.email || 'Email unavailable'}</p></div><Badge tone={isSankalpMentor ? 'blue' : 'green'}>{isSankalpMentor ? 'SANKALP CLUB MENTOR' : 'Faculty'}</Badge></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">Current assignments are available per problem in the Government Problems view.</p>{!isSankalpMentor && <button type="button" disabled={Boolean(busy) || !member._id} onClick={() => member._id && void designateSankalpMentor(member._id)} className="rounded-lg bg-[#06245C] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{busy === 'Register Sankalp mentor' ? 'Registering...' : 'Assign as Sankalp Club Mentor'}</button>}</div></article>})}{!members.some((member) => member.accountType === 'faculty') && <p className="text-sm text-slate-500">No eligible faculty members are registered for this institution.</p>}</div></SectionCard>}
      {section === 'proposals' && <SectionCard eyebrow="Funding workflow" title="Industry proposals"><div className="space-y-3">{sponsorships.map((proposal) => <article key={proposal._id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{proposal.industry?.organizationName || proposal.industry?.name || 'Industry partner'}</h3><p className="mt-1 text-sm text-slate-600">{proposal.challenge?.title || proposal.project?.title || 'Problem unavailable'}</p></div><Badge tone={proposal.status === 'accepted' ? 'green' : proposal.status === 'rejected' ? 'red' : 'amber'}>{proposal.status}</Badge></div><div className="mt-4 flex flex-wrap gap-5 text-xs text-slate-500"><span>₹{Number(proposal.amount || 0).toLocaleString('en-IN')}</span><span>{formatDate(proposal.createdAt)}</span><span>{proposal.expertise || proposal.notes || 'Purpose not provided'}</span></div>{proposal.challenge?._id && ['pending', 'approved'].includes(proposal.status) && <div className="mt-4 flex gap-2"><button disabled={busy === proposal.challenge._id} onClick={() => void action('Accept funding', () => acceptUniversitySponsorship(proposal.challenge!._id!))} className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Accept funding</button><button disabled={busy === proposal.challenge._id} onClick={() => void action('Reject funding', () => rejectUniversitySponsorship(proposal.challenge!._id!))} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">Reject</button></div>}</article>)}{!sponsorships.length && <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">No industry funding proposals have reached this institution.</p>}</div></SectionCard>}
      {section === 'projects' && <SectionCard eyebrow="Progress monitoring" title="Projects"><div className="space-y-3">{projects.map((project) => <article key={project._id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{project.title}</h3><p className="mt-1 text-sm text-slate-600">{project.challenge?.title || 'Problem unavailable'} · {project.universityDepartment || 'Department unavailable'}</p></div><Badge tone={project.status === 'completed' || project.status === 'deployed' ? 'green' : 'blue'}>{projectStatus(project)}</Badge></div><div className="mt-4 grid gap-2 text-xs text-slate-500 sm:grid-cols-4"><span>Mentor: {project.facultyMentor?.name || 'Not assigned'}</span><span>Industry: {project.industryPartners?.map((partner) => partner.organizationName || partner.name).join(', ') || 'None recorded'}</span><span>Funding: {project.challenge?.status || 'Not recorded'}</span><span>Updated: {formatDate(project.createdAt)}</span></div></article>)}{!projects.length && <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">No projects are available for this institution.</p>}</div></SectionCard>}
      {section === 'impact' && <SectionCard eyebrow="Verified outcomes" title="Impact & solutions"><div className="grid gap-4 sm:grid-cols-3"><div className="rounded-xl bg-emerald-50 p-4"><p className="text-xs font-semibold text-emerald-700">Deployed projects</p><p className="mt-2 text-3xl font-bold text-emerald-950">{completedProjects}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-500">Impact reports</p><p className="mt-2 text-3xl font-bold text-slate-900">—</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-500">Verified solutions</p><p className="mt-2 text-3xl font-bold text-slate-900">—</p></div></div><div className="mt-5 rounded-xl border border-dashed border-slate-300 p-6 text-center"><p className="font-bold text-slate-800">Impact verification data is not available yet</p><p className="mt-1 text-sm text-slate-500">The current backend provides project deployment status, but not before/after metrics or citizen feedback. No impact values are being fabricated.</p></div></SectionCard>}
      {section === 'notifications' && <SectionCard eyebrow="Notification center" title="Notifications"><div className="rounded-xl border border-dashed border-slate-300 p-8 text-center"><Bell className="mx-auto size-7 text-slate-400" /><p className="mt-3 font-bold text-slate-800">No notification feed is connected</p><p className="mt-1 text-sm text-slate-500">The backend currently has no coordinator notification endpoint. Workflow state is shown in the relevant sections.</p></div></SectionCard>}
      {section === 'profile' && <SectionCard eyebrow="Account details" title="Coordinator profile"><div className="grid gap-4 sm:grid-cols-2">{[['Name', user.name], ['Email', user.email], ['University', user.institution], ['Department', user.universityDepartment || 'Not applicable'], ['Account type', user.accountType || 'Coordinator'], ['Coordinator permission', 'University Innovation Coordinator']].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-sm font-semibold text-slate-800">{value || 'Not available'}</p></div>)}</div><p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Coordinator permission is managed by the authorization system and cannot be edited here.</p></SectionCard>}
    </div></div>
    {selectedChallenge && <ChallengeModal challenge={selectedChallenge} onClose={() => setSelectedChallenge(null)} />}
    {departmentTarget && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-wider text-red-600">Department assignment</p><h2 className="mt-1 text-lg font-bold text-slate-950">{departmentTarget.title}</h2><p className="mt-1 text-sm text-slate-500">{departmentTarget.category} · {departmentTarget.district} · {departmentTarget.urgency || departmentTarget.priority}</p></div><button onClick={() => { setDepartmentTarget(null); setSelectedDepartment(''); setSelectedSankalpMentor('') }} aria-label="Close assignment"><X className="size-5 text-slate-500" /></button></div><label className="mt-6 block text-sm font-semibold text-slate-700">{selectedDepartment === 'Sankalp Club' ? 'Department' : 'University Department'}<select value={selectedDepartment} onChange={(event) => chooseDepartment(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-3 text-sm"><option value="">Select department</option>{UNIVERSITY_ASSIGNMENT_DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}</select></label>{selectedDepartment === 'Sankalp Club' && <div className="mt-4 space-y-4 rounded-xl border border-blue-100 bg-blue-50/50 p-4"><span className="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-bold tracking-wide text-blue-800">SANKALP CLUB</span><label className="block text-sm font-semibold text-slate-700">Club Type<select value="Sankalp Club" disabled className="mt-1 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"><option>Sankalp Club</option></select></label><label className="block text-sm font-semibold text-slate-700">Mentor<select value={selectedSankalpMentor} onChange={(event) => setSelectedSankalpMentor(event.target.value)} disabled={loadingSankalpMentors || !sankalpMentors.length} className="mt-1 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm disabled:opacity-60"><option value="">Select Sankalp Club Mentor</option>{sankalpMentors.map((mentor) => <option key={mentor._id} value={mentor._id}>{mentor.name} · {mentor.email || 'Email unavailable'}</option>)}</select></label>{loadingSankalpMentors ? <p className="text-sm text-slate-500">Loading active Sankalp Club mentors...</p> : sankalpMentorError ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{sankalpMentorError}</p> : !sankalpMentors.length ? <p className="rounded-lg bg-white p-3 text-sm text-slate-600">No Sankalp Club mentor is currently available. Ask your University coordinator to assign a registered faculty member in Faculty &amp; mentors.</p> : null}</div>}<button disabled={!selectedDepartment || (selectedDepartment === 'Sankalp Club' && !selectedSankalpMentor) || Boolean(busy)} onClick={() => void action('Assign department', async () => { const response = selectedDepartment === 'Sankalp Club' ? await assignSankalpDepartment(departmentTarget._id, selectedDepartment, selectedSankalpMentor) : await assignChallengeDepartment(departmentTarget._id, selectedDepartment); if (response.success) { setDepartmentTarget(null); setSelectedDepartment(''); setSelectedSankalpMentor('') }; return response })} className="mt-4 w-full rounded-lg bg-[#06245C] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy === 'Assign department' ? 'Assigning...' : 'Assign department'}</button></div></div>}
  </main>
}
