'use client'

import { useEffect, useState } from 'react'
import { assignSankalpStudents, downloadChallengeAttachment, getChallenges, getSankalpStudents, submitSankalpChallengeForVerification, type SankalpStudent } from '@/lib/api'

type Challenge = NonNullable<Awaited<ReturnType<typeof getChallenges>>['data']>[number]
type Organization = 'NCC' | 'NSS'
type SankalpMentor = { name?: string; sankalpClubProfile?: { club?: string; role?: string; active?: boolean } }

function date(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
}

function TeamPicker({
  challenge,
  onClose,
  onAssigned,
}: {
  challenge: Challenge
  onClose: () => void
  onAssigned: () => Promise<void>
}) {
  const [organization, setOrganization] = useState<Organization>('NCC')
  const [studentsByOrganization, setStudentsByOrganization] = useState<Record<Organization, SankalpStudent[]>>({ NCC: [], NSS: [] })
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [reviewingSelection, setReviewingSelection] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function loadStudents() {
      setLoading(true)
      setError('')
      const [nccResponse, nssResponse] = await Promise.all([getSankalpStudents('NCC'), getSankalpStudents('NSS')])
      if (!active) return
      if (!nccResponse.success || !nssResponse.success) {
        setError(nccResponse.message || nssResponse.message || 'Unable to load eligible cadets and volunteers.')
      } else {
        setStudentsByOrganization({ NCC: nccResponse.data || [], NSS: nssResponse.data || [] })
      }
      setLoading(false)
    }
    void loadStudents()
    return () => { active = false }
  }, [])

  const selectedStudents = [...studentsByOrganization.NCC, ...studentsByOrganization.NSS]
    .filter((student) => selectedIds.includes(student._id))

  async function assignSelectedStudents() {
    if (busy || selectedStudents.length === 0) return
    setBusy(true)
    setError('')
    const response = await assignSankalpStudents(challenge._id, selectedStudents.map((student) => student._id))
    if (!response.success) {
      setError(response.message || 'Unable to assign selected students.')
      setBusy(false)
      return
    }
    await onAssigned()
    setBusy(false)
    onClose()
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="sankalp-team-picker-title" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div><span className="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-bold tracking-wide text-blue-800">SANKALP CLUB</span><h2 id="sankalp-team-picker-title" className="mt-2 text-xl font-bold text-slate-950">Select Cadets / Volunteers</h2><p className="mt-1 text-sm text-slate-500">{challenge.title}</p></div>
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600">Close</button>
      </div>
      <div className="mt-5 flex gap-2" role="tablist" aria-label="Student organization">
        {(['NCC', 'NSS'] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={organization === item} onClick={() => setOrganization(item)} className={`rounded-full px-4 py-2 text-sm font-bold ${organization === item ? 'bg-[#06245C] text-white' : 'bg-slate-100 text-slate-700'}`}>{item === 'NCC' ? 'NCC Cadets' : 'NSS Volunteers'}</button>)}
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading ? <p className="mt-5 text-sm text-slate-500">Loading eligible students...</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {studentsByOrganization[organization].map((student) => <label key={student._id} className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-4 hover:border-blue-400">
          <input type="checkbox" checked={selectedIds.includes(student._id)} disabled={student.availability !== 'Available' || student.currentAssignments > 0} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, student._id] : ids.filter((id) => id !== student._id))} className="mt-1 size-4 accent-blue-800" />
          <span className="min-w-0"><span className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">{student.name}<span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${organization === 'NCC' ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}`}>{student.organization}</span></span><span className="mt-1 block text-xs text-slate-600">{student.studentId} · {student.course} · {student.yearSemester}</span><span className="mt-1 block text-xs text-slate-500">{student.institution}</span>{student.skillsInterests && <span className="mt-2 block text-xs text-slate-600">Skills / interests: {student.skillsInterests}</span>}<span className="mt-2 block text-xs font-semibold text-emerald-700">{student.availability} · {student.currentAssignments} current assignments</span></span>
        </label>)}
        {!studentsByOrganization[organization].length && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600 sm:col-span-2">No eligible {organization === 'NCC' ? 'NCC cadets' : 'NSS volunteers'} are currently available at this University.</p>}
      </div>}
      <button type="button" disabled={loading || busy || selectedIds.length === 0} onClick={() => setReviewingSelection(true)} className="mt-5 w-full rounded-lg border border-blue-200 px-4 py-3 text-sm font-bold text-blue-900 disabled:opacity-50">Select Students ({selectedIds.length})</button>
      {reviewingSelection && <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/60 p-4"><h3 className="font-bold text-slate-900">Selected Team</h3><ul className="mt-3 space-y-2">{selectedStudents.map((student) => <li key={student._id} className="text-sm text-slate-700">{student.name} — {student.organization}</li>)}</ul><button type="button" disabled={busy || !selectedStudents.length} onClick={() => void assignSelectedStudents()} className="mt-4 w-full rounded-lg bg-[#06245C] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Assigning students...' : 'Assign Selected Students'}</button></div>}
    </div>
  </div>
}

export default function SankalpMentorDashboard({ user }: { user: SankalpMentor }) {
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [teamTarget, setTeamTarget] = useState<Challenge | null>(null)

  async function refresh() {
    setLoading(true)
    const response = await getChallenges()
    if (!response.success) {
      setError(response.message || 'Unable to load Sankalp Club assigned problems.')
      setChallenges([])
    } else {
      setError('')
      setChallenges((response.data || []).filter((challenge) => challenge.department === 'Sankalp Club'))
    }
    setLoading(false)
  }

  useEffect(() => { void refresh() }, [])

  async function submitForVerification(challenge: Challenge) {
    if (busyId) return
    setBusyId(challenge._id)
    setNotice('')
    const response = await submitSankalpChallengeForVerification(challenge._id)
    if (!response.success) {
      setError(response.message || 'Unable to submit this problem for verification.')
    } else {
      setError('')
      setNotice(`"${challenge.title}" was submitted for Government verification.`)
      await refresh()
    }
    setBusyId('')
  }

  const activeMentor = user.sankalpClubProfile?.club === 'Sankalp Club'
    && user.sankalpClubProfile.role === 'Sankalp Club Mentor'
    && user.sankalpClubProfile.active

  if (!activeMentor) return <main className="min-h-full bg-slate-50 p-6"><p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">An active Sankalp Club Mentor profile is required to access this dashboard.</p></main>

  return <main className="min-h-full bg-slate-50 p-5 sm:p-8">
    <div className="mx-auto max-w-[1450px]">
      <header className="rounded-2xl bg-[#06245C] p-6 text-white shadow-lg sm:p-8"><span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold tracking-wide">SANKALP CLUB</span><h1 className="mt-3 text-2xl font-bold sm:text-3xl">Sankalp Club Assigned Problems</h1><p className="mt-2 text-sm text-blue-100">Review assigned community problems and build NCC / NSS teams from active, available student records.</p><p className="mt-4 text-sm font-semibold text-blue-100">Mentor: {user.name || 'Sankalp Club Mentor'}</p></header>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      <section className="mt-6 space-y-4">
        {loading ? <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading assigned problems...</p> : challenges.map((challenge) => <article key={challenge._id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><span className="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold tracking-wide text-blue-800">SANKALP CLUB</span><h2 className="mt-2 break-words text-lg font-bold text-slate-950">{challenge.title}</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold capitalize text-slate-700">{challenge.status.replaceAll('_', ' ')}</span></div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{challenge.description}</p>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><p><span className="font-semibold text-slate-800">Location:</span> {challenge.villageOrCity || 'Not available'}</p><p><span className="font-semibold text-slate-800">District:</span> {challenge.district}</p><p><span className="font-semibold text-slate-800">Urgency:</span> {challenge.urgency || challenge.priority}</p><p><span className="font-semibold text-slate-800">Assigned date:</span> {date(challenge.departmentMentorAssignedAt || challenge.departmentAssignedAt)}</p></div>
          <div className="mt-4 flex flex-wrap gap-2"><span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-800">NCC · {(challenge.selectedStudents || []).filter((student) => student.organization === 'NCC').length} Cadets</span><span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-bold text-green-800">NSS · {(challenge.selectedStudents || []).filter((student) => student.organization === 'NSS').length} Volunteers</span></div>
          {challenge.selectedStudents?.length ? <ul className="mt-3 flex flex-wrap gap-2">{challenge.selectedStudents.map((student, index) => <li key={`${student.studentId?._id || index}-${student.organization}`} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">{student.studentId?.name || 'Student'} · {student.organization}</li>)}</ul> : null}
          <div className="mt-4 border-t border-slate-100 pt-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Evidence / photos</p>{challenge.attachments?.length ? <div className="mt-2 flex flex-wrap gap-2">{challenge.attachments.map((attachment) => <button key={attachment._id} type="button" onClick={() => void downloadChallengeAttachment(challenge._id, attachment._id, attachment.originalName)} className="rounded-lg bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-blue-800 hover:bg-blue-50">{attachment.originalName} · Download</button>)}</div> : <p className="mt-1 text-sm text-slate-500">No evidence/photos attached.</p>}</div>
          <div className="mt-5 flex flex-wrap gap-3">{!challenge.studentsAssigned && <button type="button" onClick={() => setTeamTarget(challenge)} className="rounded-lg bg-[#06245C] px-4 py-2.5 text-sm font-bold text-white">Select Cadets / Volunteers</button>}{challenge.studentsAssigned && challenge.status === 'in_progress' && <button type="button" disabled={busyId === challenge._id} onClick={() => void submitForVerification(challenge)} className="rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busyId === challenge._id ? 'Submitting...' : 'Submit for Verification'}</button>}</div>
        </article>)}
        {!loading && !challenges.length && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No Sankalp Club problems are assigned to you yet.</p>}
      </section>
    </div>
    {teamTarget && <TeamPicker challenge={teamTarget} onClose={() => setTeamTarget(null)} onAssigned={refresh} />}
  </main>
}
