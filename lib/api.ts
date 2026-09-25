import type { EmergencyScenario } from "./emergency-helplines";

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export async function assignChallengeDepartment(challengeId: string, department: string) {
  return apiCall(`/api/challenges/${encodeURIComponent(challengeId)}/department`, {
    method: 'PATCH',
    body: JSON.stringify({ department }),
  });
}

export async function getDepartmentMentors(challengeId: string) {
  return apiCall<Array<{
    _id: string;
    name: string;
    email?: string;
    institution?: string;
    universityDepartment?: string;
    accountType?: string;
    primaryClub?: string | null;
  }>>(`/api/challenges/${encodeURIComponent(challengeId)}/department-mentors`, {
    method: 'GET',
  });
}

export async function assignChallengeMentor(challengeId: string, departmentMentor: string) {
  return apiCall(`/api/challenges/${encodeURIComponent(challengeId)}/department-mentor`, {
    method: 'PATCH',
    body: JSON.stringify({ departmentMentor }),
  });
}

export async function getDepartmentChallengeMentors(challengeId: string) {
  return apiCall<Array<{
    _id: string;
    name: string;
    email?: string;
    institution?: string;
    universityDepartment?: string;
    accountType?: string;
  }>>(`/api/challenges/${encodeURIComponent(challengeId)}/department-mentors`, { method: 'GET' });
}

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
const API_REQUEST_TIMEOUT_MS = 15000;

function resolveApiUrl(endpoint: string) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${apiBaseUrl}${endpoint}`;
}

export async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const headers = new Headers(options.headers);
  if (!(typeof FormData !== 'undefined' && options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Attach JWT token if it exists
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let removeExternalAbortListener: (() => void) | undefined;
  try {
    const controller = new AbortController();
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else {
        const abortExternalRequest = () => controller.abort();
        options.signal.addEventListener('abort', abortExternalRequest, { once: true });
        removeExternalAbortListener = () => options.signal?.removeEventListener('abort', abortExternalRequest);
      }
    }
    timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
    const response = await fetch(resolveApiUrl(endpoint), {
      ...options,
      headers,
      signal: controller.signal,
    });

    const responseText = await response.text();
    let data: Partial<ApiResponse<T>> = {};
    if (responseText.trim()) {
      try {
        data = JSON.parse(responseText) as Partial<ApiResponse<T>>;
      } catch {
        data = {
          success: false,
          message: responseText.trim(),
        };
      }
    }

    if (!response.ok) {
      return {
        success: false,
        message: data.message || `HTTP Error: ${response.status}`,
      };
    }

    return {
      success: true,
      ...data,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof DOMException && error.name === 'AbortError'
        ? 'The request timed out. Please check the backend connection and try again.'
        : error instanceof Error ? error.message : 'An error occurred',
    };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    removeExternalAbortListener?.();
  }
}

export async function login(email: string, password: string, coordinator?: { institution: string; code: string }) {
  return apiCall<{
    token: string;
    user: {
      _id: string;
      name: string;
      email: string;
      role: string;
      district?: string;
      governmentDistrict?: string;
      universityRole?: 'member' | 'innovation_coordinator';
      clubRole?: 'member' | 'coordinator';
      clubCoordinatorClub?: string | null;
      institution?: string;
      universityDepartment?: string;
      accountType?: string;
      primaryClub?: string | null;
    };
  }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, institution: coordinator?.institution, coordinatorCode: coordinator?.code }),
  });
}

export async function register(userData: Record<string, any>) {
  return apiCall<{
    token: string;
    user: {
      _id: string;
      name: string;
      email: string;
      role: string;
      district?: string;
      governmentDistrict?: string;
    };
  }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(userData),
  });
}

export async function getUniversityInstitutions() {
  return apiCall<string[]>('/api/auth/universities', { method: 'GET' });
}

export async function generateUniversityCoordinatorCode(institution: string) {
  return apiCall<{ institution: string; code: string }>('/api/auth/university-coordinator/generate-code', {
    method: 'POST',
    body: JSON.stringify({ institution }),
  });
}

export async function getCurrentUser() {
  return apiCall<{
    user: {
      _id: string;
      name: string;
      email: string;
      role: string;
      institution?: string;
      universityDepartment?: string;
      accountType?: string;
      primaryClub?: string | null;
      universityRole?: 'member' | 'innovation_coordinator';
    };
  }>('/api/auth/me', {
    method: 'GET',
  });
}

export async function updateUniversityProfile(department: string, accountType: 'student' | 'researcher', primaryClub: string) {
  return apiCall<{ user: {
    _id: string;
    name: string;
    email: string;
    role: string;
    institution?: string;
    universityDepartment?: string;
    accountType?: string;
    universityRole?: 'member' | 'innovation_coordinator';
  } }>('/api/auth/university-profile', {
    method: 'PATCH',
    body: JSON.stringify({ department, accountType, primaryClub }),
  });
}

export async function getClubActivities(club: string) {
  return apiCall<Array<{ _id: string; title: string; description: string; club: string; date: string; status: 'upcoming' | 'completed'; participants?: { _id?: string; name?: string }[]; createdBy?: { name?: string } }>>(`/api/clubs/${encodeURIComponent(club)}/activities`, { method: 'GET' });
}

export async function getClubMembers(club: string) {
  return apiCall<Array<{ _id: string; name: string; email?: string; universityDepartment?: string; accountType?: string; clubRole?: string }>>(`/api/clubs/${encodeURIComponent(club)}/members`, { method: 'GET' });
}

export async function createClubActivity(club: string, data: { title: string; description: string; date: string }) {
  return apiCall(`/api/clubs/${encodeURIComponent(club)}/activities`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateClubActivity(club: string, activityId: string, data: { title?: string; description?: string; date?: string; status?: 'upcoming' | 'completed' }) {
  return apiCall(`/api/clubs/${encodeURIComponent(club)}/activities/${encodeURIComponent(activityId)}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function registerForClubActivity(club: string, activityId: string) {
  return apiCall(`/api/clubs/${encodeURIComponent(club)}/activities/${encodeURIComponent(activityId)}/register`, { method: 'POST', body: JSON.stringify({}) });
}

export async function chatWithSahayak(problem: string, language: 'en' | 'hi' = 'en') {
  return apiCall<{
    offline?: boolean;
    message?: string;
    understanding?: { summary?: string };
    severity?: string;
    can_solve_myself?: boolean;
    solution_info?: { steps?: string[]; tools_materials?: string[]; estimated_time?: string; estimated_cost?: string };
    safety_guidance?: { precautions?: string[]; when_to_stop?: string };
    escalation?: { required?: boolean; contact?: string; reason?: string };
    prevention?: string[];
    helplines?: { name?: string; number?: string; purpose?: string }[];
    emergency?: boolean;
    emergencyScenario?: EmergencyScenario;
  }>('/api/sahayak/chat', {
    method: 'POST',
    body: JSON.stringify({ problem, language }),
  });
}

export async function detectUrgency(details: {
  title: string;
  description: string;
  category: string;
  affected: string;
  expectedImpact: string;
  location: string;
}) {
  return apiCall<{
    urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    reason: string;
    confidence: number;
  }>('/api/ai/detect-urgency', {
    method: 'POST',
    body: JSON.stringify(details),
  });
}

export type PortalSearchResult = {
  type: string;
  id: string;
  title: string;
  description: string;
  status: string;
  href: string;
};

export type PortalNotification = {
  _id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
};

export async function searchPortal(query: string, signal?: AbortSignal) {
  return apiCall<PortalSearchResult[]>(`/api/search?q=${encodeURIComponent(query)}`, { method: 'GET', signal });
}

let notificationsRequest: Promise<ApiResponse<{ notifications: PortalNotification[]; unreadCount: number }>> | null = null;
let notificationsCache: { expiresAt: number; response: ApiResponse<{ notifications: PortalNotification[]; unreadCount: number }> } | null = null;

export async function getNotifications() {
  if (notificationsCache && notificationsCache.expiresAt > Date.now()) return notificationsCache.response;
  if (notificationsRequest) return notificationsRequest;
  notificationsRequest = apiCall<{ notifications: PortalNotification[]; unreadCount: number }>('/api/notifications?page=1&limit=20', { method: 'GET' });
  try {
    const response = await notificationsRequest;
    if (response.success) notificationsCache = { expiresAt: Date.now() + 500, response };
    return response;
  } finally {
    notificationsRequest = null;
  }
}

export async function markNotificationRead(id: string) {
  return apiCall<PortalNotification>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}

export async function markAllNotificationsRead() {
  return apiCall('/api/notifications/read-all', { method: 'PATCH' });
}

export async function getSolutionRecommendations(challengeId: string) {
  return apiCall<{
    recommendations: {
      solutionId: string;
      reason: string;
      relevantAspects: string[];
      solution: {
        _id: string;
        title: string;
        solutionTitle?: string;
        solutionDescription?: string;
        solutionApproach?: string;
        technology?: string;
        implementationDetails?: string;
        expectedOutcome?: string;
        universityDepartment?: string;
        challenge?: { title?: string; description?: string; category?: string; status?: string; district?: string };
      };
    }[];
  }>('/api/ai/solution-recommendations', {
    method: 'POST',
    body: JSON.stringify({ challengeId }),
  });
}

export async function reverseGeocode(latitude: number, longitude: number) {
  return apiCall<{
    displayName: string;
    village: string;
    ward: string;
    town: string;
    city: string;
    district: string;
    state: string;
    country: string;
  }>(`/api/location/reverse-geocode?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`, {
    method: 'GET',
  });
}

let rewardsRequest: Promise<ApiResponse<{
  summary: {
    impactTokens: number;
    lifetimeImpactTokens: number;
    totalVerifiedProblems: number;
    totalRewardsRedeemed: number;
    totalRewardAmountRedeemed: number;
    virtualCashBalance: number;
    redeemableBlocks: number;
    rewardAmount: number;
    nextRewardTokens: number;
  };
  history: Array<{
    tokensRedeemed: number;
    rewardAmount: number;
    status: string;
    redeemedAt: string;
  }>;
}>> | null = null;
let rewardsCache: { expiresAt: number; response: ApiResponse<any> } | null = null;

export async function getMyRewards() {
  if (rewardsCache && rewardsCache.expiresAt > Date.now()) return rewardsCache.response;
  if (rewardsRequest) return rewardsRequest;
  rewardsRequest = apiCall<{
    summary: {
      impactTokens: number;
      lifetimeImpactTokens: number;
      totalVerifiedProblems: number;
      totalRewardsRedeemed: number;
      totalRewardAmountRedeemed: number;
      virtualCashBalance: number;
      redeemableBlocks: number;
      rewardAmount: number;
      nextRewardTokens: number;
    };
    history: Array<{
      tokensRedeemed: number;
      rewardAmount: number;
      status: string;
      redeemedAt: string;
    }>;
  }>('/api/rewards/me', { method: 'GET' });
  try {
    const response = await rewardsRequest;
    if (response.success) rewardsCache = { expiresAt: Date.now() + 500, response };
    return response;
  } finally {
    rewardsRequest = null;
  }
}

export async function redeemMyReward() {
  rewardsCache = null;
  return apiCall('/api/rewards/redeem', { method: 'POST', body: JSON.stringify({}) });
}

export async function getChallenges() {
  return apiCall<Array<{
    _id: string;
    title: string;
    description: string;
    category: string;
    district: string;
    villageOrCity: string;
    status: string;
    assignmentStatus?: 'unassigned' | 'pending' | 'awaiting_acceptance' | 'accepted';
    department?: string | null;
    departmentAssignedAt?: string | null;
    departmentMentorAssignedBy?: { _id?: string; name?: string; email?: string } | null;
    departmentMentorAssignedAt?: string | null;
    acceptedByUniversity?: { _id?: string; name?: string; email?: string };
    acceptedAt?: string;
    cancelledBy?: { _id?: string; name?: string };
    cancelledAt?: string;
    cancellationReason?: string | null;
    priority: string;
    fundingAmount?: number;
    fundingStatus?: 'pending' | 'approved';
    fundingApprovedAt?: string;
    industryFundingStatus?: 'pending' | 'eligible' | 'funded_pending_university_acceptance' | 'accepted' | 'rejected' | 'not_required';
    industryFundingAmount?: number;
    industryFundingAt?: string;
    industryFundedBy?: { _id?: string; name?: string; organizationName?: string; email?: string };
    createdAt?: string;
    submittedBy?: { _id?: string; name?: string; email?: string; role?: string };
    rawStatus?: string;
    assignedUniversity?: { _id?: string; name?: string; email?: string; institution?: string; universityDepartment?: string };
    departmentMentor?: { _id?: string; name?: string; email?: string; institution?: string; universityDepartment?: string; accountType?: string } | null;
    citizenContactNumber?: string;
    affected?: string;
    expectedImpact?: string;
    solutionTitle?: string;
    solutionDescription?: string;
    solutionApproach?: string;
    technology?: string;
    implementationDetails?: string;
    expectedOutcome?: string;
    solutionStatus?: 'draft' | 'submitted';
    urgency?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    urgencySource?: 'ai_detected' | 'manually_adjusted' | 'fallback';
    urgencyReason?: string;
    project?: {
      _id: string;
      title?: string;
      progressPercentage?: number;
      currentStage?: string;
      status?: string;
      university?: { _id?: string; name?: string; institution?: string } | string;
      universityDepartment?: string;
      facultyMentor?: { _id?: string; name?: string; email?: string } | string;
      teamMembers?: Array<{ _id?: string; name?: string; accountType?: string }>;
    } | null;
    attachments?: { _id: string; originalName: string; mimeType: string; size: number; uploadedAt?: string }[];
  }>>('/api/challenges', {
    method: 'GET',
  });
}

export async function getUniversities() {
  return apiCall<Array<{
    _id: string;
    name: string;
    email?: string;
    institution?: string;
    facultyMentor?: { _id?: string; name?: string; email?: string; universityDepartment?: string; accountType?: string };
    accountType?: string;
    universityRole?: string;
  }>>('/api/users/universities', {
    method: 'GET',
  });
}

export async function getUniversityParticipation() {
  return apiCall<Array<{
    universityId: string;
    universityName: string;
    assigned: number;
    active: number;
    completed: number;
    status: 'Active' | 'Registered';
  }>>('/api/users/university-participation', { method: 'GET' });
}

export type GovernmentAnalytics = {
  challenges: { total: number; underReview: number; approved: number; assigned: number; fundingApproved: number; inProgress: number; resolved: number };
  projects: { total: number; proposed: number; prototype: number; testing: number; deployed: number; completed: number };
  universities: { total: number; withAssignedChallenges: number; withActiveProjects: number };
  impact: { solutionsDeployed: number; communitiesResolved: number; studentsInvolved: number; facultyMentors: number };
  funding: { approvedAmount: number; fundedCount: number; sponsorship?: Record<string, { count: number; amount: number }> };
};

export async function getGovernmentAnalytics() {
  return apiCall<GovernmentAnalytics>('/api/dashboard/analytics', { method: 'GET' });
}

export async function getUniversityMembers() {
  return apiCall<Array<{
    _id: string;
    name: string;
    email?: string;
    institution?: string;
    universityDepartment?: string;
    facultyMentor?: { _id?: string; name?: string; email?: string; universityDepartment?: string; accountType?: string };
    accountType?: string;
  }>>('/api/users/university-members', { method: 'GET' });
}

export async function getDepartmentMembers() {
  return apiCall<Array<{
    _id: string;
    name: string;
    email?: string;
    institution?: string;
    universityDepartment?: string;
    accountType?: string;
    primaryClub?: string | null;
  }>>('/api/users/department-members', { method: 'GET' });
}

export async function getProjects() {
  return apiCall<Array<{
    _id: string;
    title: string;
    description: string;
    challenge?: { _id?: string; title?: string; category?: string; district?: string; status?: string; industryFundingStatus?: string; industryFundingAmount?: number; industryFundingAcceptedAt?: string };
    university?: { _id?: string; name?: string; institution?: string; universityDepartment?: string };
    universityDepartment?: string;
    facultyMentor?: { _id?: string; name?: string; accountType?: string; universityDepartment?: string };
    projectType: string;
    status: string;
    progressPercentage?: number;
    currentStage?: string;
    completedWork?: string;
    progressUpdates?: { stage: string; percentage: number; description?: string; updatedBy?: string; updatedAt?: string }[];
    remainingWork?: string;
    nextTask?: string;
    assignmentStatus?: 'unassigned' | 'pending' | 'awaiting_acceptance' | 'accepted';
    acceptedByUniversity?: { _id?: string; name?: string; email?: string };
    acceptedAt?: string;
    solutionSummary?: string;
    expectedImpact?: string;
    solutionTitle?: string;
    solutionDescription?: string;
    solutionApproach?: string;
    technology?: string;
    implementationDetails?: string;
    expectedOutcome?: string;
    solutionStatus?: 'draft' | 'submitted';
    estimatedBudget?: number;
    timeline?: { startDate?: string; expectedCompletionDate?: string };
    teamMembers?: { _id?: string; name?: string; universityDepartment?: string; accountType?: string; email?: string }[];
    industryPartners?: { _id?: string; name?: string; organizationName?: string; organizationType?: string; expertise?: string; email?: string }[];
    createdBy?: { name?: string };
    createdAt?: string;
  }>>('/api/projects', {
    method: 'GET',
  });
}

export async function getIndustryOpportunities() {
  return apiCall<any[]>('/api/industry/opportunities', { method: 'GET' })
}

export async function getIndustrySponsorships() {
  return apiCall<any[]>('/api/industry/sponsorships', { method: 'GET' })
}

export async function createIndustrySponsorship(data: { project?: string; challenge?: string; amount: number; expertise?: string; notes?: string; contactPerson?: string; contactEmail?: string; contactPhone?: string }) {
  return apiCall<any>('/api/industry/sponsorships', { method: 'POST', body: JSON.stringify(data) })
}

export async function getUniversitySponsorships() {
  return apiCall<any[]>('/api/industry/university-sponsorships', { method: 'GET' })
}

export async function acceptUniversitySponsorship(challengeId: string) {
  return apiCall<any>(`/api/industry/challenges/${encodeURIComponent(challengeId)}/funding/accept`, { method: 'PATCH' })
}

export async function rejectUniversitySponsorship(challengeId: string) {
  return apiCall<any>(`/api/industry/challenges/${encodeURIComponent(challengeId)}/funding/reject`, { method: 'PATCH' })
}

export async function acceptIndustryFunding(challengeId: string) {
  return apiCall<any>(`/api/industry/challenges/${encodeURIComponent(challengeId)}/funding/accept`, { method: 'PATCH' })
}

export async function getProjectById(id: string) {
  return apiCall<{
    _id: string;
    title: string;
    description: string;
    challenge?: { _id?: string; title?: string; category?: string; district?: string; status?: string; description?: string; industryFundingStatus?: string; industryFundingAmount?: number; industryFundingAcceptedAt?: string };
    university?: { _id?: string; name?: string; institution?: string; universityDepartment?: string };
    universityDepartment?: string;
    projectType: string;
    status: string;
    progressPercentage?: number;
    currentStage?: string;
    completedWork?: string;
    progressUpdates?: { stage: string; percentage: number; description?: string; updatedBy?: string; updatedAt?: string }[];
    solutionSummary?: string;
    expectedImpact?: string;
    estimatedBudget?: number;
    timeline?: { startDate?: string; expectedCompletionDate?: string };
    teamMembers?: { _id?: string; name?: string; universityDepartment?: string; accountType?: string; email?: string }[];
    industryPartners?: { _id?: string; name?: string; organizationName?: string; organizationType?: string; expertise?: string; email?: string }[];
    createdBy?: { _id?: string; name?: string; institution?: string; universityDepartment?: string };
    createdAt?: string;
  }>(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
}

export async function createProject(projectData: {
  title: string;
  description: string;
  challenge: string;
  universityDepartment: string;
  facultyMentor?: string;
  projectType: string;
  solutionSummary: string;
  objectives?: string[];
  expectedImpact: string;
  estimatedBudget?: number;
  timeline: { startDate: string; expectedCompletionDate: string };
  teamMembers?: string[];
}) {
  return apiCall('/api/projects', {
    method: 'POST',
    body: JSON.stringify(projectData),
  });
}

export async function updateProjectStatus(id: string, status: string) {
  return apiCall(`/api/projects/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function updateProjectProgress(id: string, currentStage: string) {
  return apiCall(`/api/projects/${encodeURIComponent(id)}/progress`, {
    method: 'PATCH',
    body: JSON.stringify({ currentStage }),
  });
}

export async function updateProjectTeam(id: string, teamMembers: string[]) {
  return apiCall(`/api/projects/${encodeURIComponent(id)}/team`, {
    method: 'PATCH',
    body: JSON.stringify({ teamMembers }),
  });
}

export async function updateProjectSolution(id: string, solution: {
  solutionTitle?: string;
  solutionDescription?: string;
  solutionApproach?: string;
  technology?: string;
  implementationDetails?: string;
  expectedOutcome?: string;
  solutionStatus?: 'draft' | 'submitted';
}) {
  return apiCall(`/api/projects/${encodeURIComponent(id)}/solution`, {
    method: 'PATCH',
    body: JSON.stringify(solution),
  });
}

export async function updateProjectFaculty(id: string, facultyMentor: string) {
  return apiCall(`/api/projects/${encodeURIComponent(id)}/faculty`, {
    method: 'PATCH',
    body: JSON.stringify({ facultyMentor }),
  });
}

export async function updateProjectPartners(id: string, industryPartners: string[]) {
  return apiCall(`/api/projects/${encodeURIComponent(id)}/partners`, {
    method: 'PATCH',
    body: JSON.stringify({ industryPartners }),
  });
}

export async function getCollaborations(projectId?: string) {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return apiCall<Array<{
    _id: string;
    project?: { _id?: string; title?: string; status?: string };
    industryPartner?: { _id?: string; name?: string; organizationName?: string; organizationType?: string; expertise?: string };
    collaborationType: string;
    proposal: string;
    fundingAmount?: number;
    status: string;
    createdAt?: string;
  }>>(`/api/collaborations${query}`, { method: 'GET' });
}

export async function createCollaboration(collaborationData: {
  project: string;
  collaborationType: string;
  proposal: string;
  fundingAmount?: number;
}) {
  return apiCall('/api/collaborations', {
    method: 'POST',
    body: JSON.stringify(collaborationData),
  });
}

export async function updateCollaborationStatus(id: string, status: string) {
  return apiCall(`/api/collaborations/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function updateChallengeStatus(id: string, status: string) {
  return apiCall(`/api/challenges/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function updateChallengePriority(id: string, priority: string) {
  return apiCall(`/api/challenges/${encodeURIComponent(id)}/priority`, {
    method: 'PATCH',
    body: JSON.stringify({ priority }),
  });
}

export async function assignChallenge(id: string, assignedUniversity: string) {
  return apiCall(`/api/challenges/${encodeURIComponent(id)}/assign`, {
    method: 'PATCH',
    body: JSON.stringify({ assignedUniversity }),
  });
}

export async function cancelChallenge(id: string, cancellationReason?: string) {
  return apiCall(`/api/challenges/${encodeURIComponent(id)}/cancel`, {
    method: 'PATCH',
    body: JSON.stringify({ cancellationReason }),
  });
}

export async function getChallengeById(id: string) {
  return apiCall<{
    _id: string;
    title: string;
    description: string;
    category: string;
    district: string;
    villageOrCity: string;
    status: string;
    priority: string;
    fundingAmount?: number;
    fundingStatus?: 'pending' | 'approved';
    fundingApprovedAt?: string;
    createdAt?: string;
    submittedBy?: { name?: string; email?: string; role?: string; district?: string; villageOrCity?: string };
    assignedUniversity?: { name?: string; email?: string; institution?: string; universityDepartment?: string };
    citizenContactNumber?: string;
    attachments?: { _id: string; originalName: string; mimeType: string; size: number; uploadedAt?: string }[];
    location?: { latitude?: number | null; longitude?: number | null };
    media?: { images?: { url?: string }[]; videos?: { url?: string }[]; documents?: { url?: string; fileName?: string }[] };
    aiAnalysis?: { category?: string; priority?: string; summary?: string; analyzedAt?: string };
  }>(`/api/challenges/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
}

export async function createChallenge(challengeData: {
  title: string;
  description: string;
  category: string;
  district: string;
  villageOrCity: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  citizenContactNumber?: string;
  location?: { latitude: number; longitude: number };
  media?: { images?: { url: string }[]; videos?: { url: string }[]; documents?: { url: string; fileName: string }[] };
}, files: File[] = []) {
  const body = files.length
    ? (() => {
      const formData = new FormData();
      Object.entries(challengeData).forEach(([key, value]) => {
        if (value !== undefined && value !== null) formData.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      });
      files.forEach((file) => formData.append('files', file));
      return formData;
    })()
    : JSON.stringify(challengeData);
  return apiCall<{
    _id: string;
    title: string;
    status: string;
  }>('/api/challenges', {
    method: 'POST',
    body,
  });
}

export async function downloadChallengeAttachment(challengeId: string, attachmentId: string, fileName: string) {
  const token = getAuthToken();
  const response = await fetch(resolveApiUrl(`/api/challenges/${encodeURIComponent(challengeId)}/attachments/${encodeURIComponent(attachmentId)}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    let message = `HTTP Error: ${response.status}`;
    try { message = (await response.json()).message || message; } catch {}
    throw new Error(message);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export async function acceptChallenge(id: string) {
  return apiCall(`/api/challenges/${encodeURIComponent(id)}/accept`, {
    method: 'PATCH',
  });
}

export function saveAuthToken(token: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('auth_token', token);
  }
}

export function getAuthToken() {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('auth_token');
  }
  return null;
}

export function clearAuthToken() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('current_user');
    localStorage.removeItem('role');
    localStorage.removeItem('dashboard_view');
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('current_user');
    sessionStorage.removeItem('role');
    sessionStorage.removeItem('dashboard_view');
    sessionStorage.removeItem('auth_session_fresh');
  }
}

export function saveCurrentUser(user: Record<string, any>) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('current_user', JSON.stringify(user));
  }
}

export function saveAuthSession(token: string, user: Record<string, any>) {
  clearAuthToken();
  saveAuthToken(token);
  saveCurrentUser(user);
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('auth_session_fresh', '1');
    window.setTimeout(() => sessionStorage.removeItem('auth_session_fresh'), 2000);
  }
}

export function getCurrentUserFromStorage() {
  if (typeof window !== 'undefined') {
    const user = localStorage.getItem('current_user');
    if (!user) return null;
    try {
      return JSON.parse(user);
    } catch {
      localStorage.removeItem('current_user');
      return null;
    }
  }
  return null;
}
