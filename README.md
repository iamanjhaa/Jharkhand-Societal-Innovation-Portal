# 🇮🇳 Jharkhand Societal Innovation Portal

### Team Innovate4India | Smart India Hackathon 2026

A digital platform that connects **Citizens, District Government, Universities, and Industry** to transform real-world societal problems into practical and scalable solutions.

---

##  About the Project

The **Jharkhand Societal Innovation Portal** provides an end-to-end digital workflow for identifying, verifying, solving, and tracking societal problems.

Citizens can report local problems with **descriptions, location, and supporting evidence**. District Government authorities verify and prioritize these problems and assign them to suitable universities.

Universities can accept verified problems, assign departments, faculty mentors, students, and researchers, and develop solutions. Industry partners can support these solutions through **funding, mentorship, resources, and deployment support**.

The platform tracks the complete journey from **problem reporting to verified solution**.

---

##  End-to-End Workflow

```text
Citizen
   ↓
Submit Societal Problem
   ↓
District Government
   ↓
Verify & Prioritize
   ↓
Assign University
   ↓
University Coordinator
   ↓
Accept Problem
   ↓
Assign Department
   ↓
Industry
   ↓
Funding / Mentorship / Resources
   ↓
Department
   ↓
Faculty Mentor + Students + Researchers
   ↓
Project Development
   ↓
Testing
   ↓
Deployment
   ↓
Government Verification
   ↓
Problem Solved
   ↓
Solution Library






# 🇮🇳 Jharkhand Societal Innovation Portal

### Team Innovate4India | Smart India Hackathon 2026

A digital platform that connects **Citizens, District Government, Universities, and Industry** to transform real-world societal problems into practical and scalable solutions.

---

## 🚀 About the Project

The **Jharkhand Societal Innovation Portal** provides an end-to-end digital workflow for identifying, verifying, solving, and tracking societal problems.

Citizens can report local problems with **descriptions, location, and supporting evidence**. District Government authorities verify and prioritize these problems and assign them to suitable universities.

Universities can accept verified problems, assign departments, faculty mentors, students, and researchers, and develop solutions. Industry partners can support these solutions through **funding, mentorship, resources, and deployment support**.

The platform tracks the complete journey from **problem reporting to verified solution**.

---

## 🔄 End-to-End Workflow

```text
Citizen
   ↓
Submit Societal Problem
   ↓
District Government
   ↓
Verify & Prioritize
   ↓
Assign University
   ↓
University Coordinator
   ↓
Accept Problem
   ↓
Assign Department
   ↓
Industry
   ↓
Funding / Mentorship / Resources
   ↓
Department
   ↓
Faculty Mentor + Students + Researchers
   ↓
Project Development
   ↓
Testing
   ↓
Deployment
   ↓
Government Verification
   ↓
Problem Solved
   ↓
Solution Library
✨ Key Features
👥 Citizen
Submit local societal problems
Upload photo, video, or document evidence
Add location and problem details
Track problem status and project progress
Receive workflow notifications
Impact Rewards / Virtual Cash system
🏛️ District Government
District-wise problem management
Verify submitted problems
Set problem priority
Assign problems to universities
Monitor project progress
Verify completed solutions
🎓 University
University Coordinator dashboard
Accept Government-assigned problems
Assign appropriate departments
Faculty mentor selection
Student and researcher team formation
Project creation and progress tracking
🏢 Industry
View eligible solution opportunities
Submit funding proposals
Provide mentorship and resources
Support testing and deployment
Monitor supported projects
🤖 AI & Sahayak
AI-assisted urgency detection
Evidence analysis
AI-based solution recommendations
Reuse of verified previous solutions
Sahayak AI assistance
Online and offline assistance
📚 Solution Library

Completed and Government-verified solutions are stored for future reference.

When a similar problem appears, the system can recommend relevant previous solutions for review.

AI recommendations assist decision-making and do not automatically apply previous solutions.

🔐 Security
JWT-based authentication
bcrypt password hashing
Role-based authorization
District-level Government access control
University-level access isolation
Backend permission validation
Protected evidence access
Secure file handling
Workflow-based authorization
🛠️ Technology Stack
Frontend
Next.js
React
TypeScript
Tailwind CSS
Lucide React
Backend
Node.js
Express.js
Database
MongoDB
Mongoose
Authentication
JWT
bcrypt
AI
Sahayak AI
OpenRouter
Development & Testing
GitHub
Postman
Render
📁 Project Architecture
Jharkhand-Societal-Innovation-Portal/
│
├── app/
├── components/
├── lib/
├── public/
│
├── server/
│   ├── controllers/
│   ├── models/
│   ├── routes/
│   ├── middleware/
│   ├── utils/
│   └── server.js
│
├── sahayak-service/
│
├── package.json
├── next.config.ts
├── tsconfig.json
└── README.md
🎯 Problem We Address

Communities face problems related to:

Water management
Roads and infrastructure
Flooding
Sanitation
Waste management
Education
Healthcare
Agriculture
Environment
Rural development
Public services

The portal creates a structured mechanism to move these problems from identification → verification → solution development → deployment.

💡 Innovation
1. End-to-End Collaboration

Connects:

Citizen → Government → University → Industry

within one workflow.

2. AI-Assisted Problem Prioritization

AI can analyze problem context and assist in determining urgency.

3. AI Solution Reuse

Previous verified solutions can be recommended for similar future problems.

4. Industry Collaboration

Industry can contribute funding, mentorship, technical expertise, and deployment support.

5. District-Level Governance

Government access and problem management are organized according to districts.

6. Solution Library

Verified solutions become reusable knowledge for future societal challenges.

7. Sahayak AI

Provides AI-assisted support with online and offline assistance capabilities.

## Sankalp Club workflow

Sankalp Club is a special problem assignment destination, separate from the six academic departments. It uses the existing university coordinator workflow:

1. Government assigns the problem to a university and the university accepts it.
2. The University Coordinator opens **Faculty & mentors** and designates an existing faculty account as a Sankalp Club Mentor. No mentor accounts or student records are seeded.
3. In **Assign Department**, the coordinator selects **Sankalp Club**, confirms the Sankalp Club type, and selects an active mentor.
4. An NCC/NSS student enrolls with their registered university profile and provides their real Student ID, course, and year/semester. The mentor dashboard then lists eligible active, available members from that same university.
5. The mentor can build a mixed NCC/NSS team and submit the assigned problem for Government verification. Students remain reserved until the problem is resolved, rejected, or cancelled.

The Sankalp APIs are authenticated under `/api/sankalp`: `GET /mentors` and `POST /mentors` are University Coordinator operations, `GET /students?organization=NCC|NSS` and `POST /assign-students` require an active Sankalp Club Mentor profile, and `POST /challenges/:id/submit-for-verification` submits that mentor's assigned problem for Government verification.

## Sahayak emergency SOS

When a citizen tells Sahayak they are personally in immediate danger, the portal creates an authenticated emergency session and sends a predefined alert to the citizen's enabled emergency contacts. It does not send SMS for general accident questions or reports about other people. The citizen can save up to five contacts in Sahayak's **Emergency Contacts** panel; Indian 10-digit numbers are normalized to `+91`, while international numbers must include their country code.

The server stores each emergency session for six hours and makes it available through `GET /api/emergency/active`, so an installed PWA can restore Emergency Mode after reopening. `POST /api/emergency/create` starts a session, and `POST /api/emergency/resolve/:id` resolves it. These routes use the existing JWT authentication and only operate on the signed-in citizen's contacts and sessions. Repeated creation requests return the active session without sending another initial SMS.

SMS is server-only. Configure `SMS_PROVIDER=twilio`, `SMS_ACCOUNT_ID`, `SMS_API_KEY`, `SMS_API_SECRET`, and `SMS_FROM_NUMBER` in the project-root `.env`; never add credentials to `NEXT_PUBLIC_*` variables or commit them. Start the backend from `server` with `npm run dev`. If configuration is missing, the emergency session is still recorded and the UI reports that no SMS was sent. Twilio trial accounts may only message verified recipient numbers.

## Expected Impact
Citizens

Better problem reporting, transparency, and progress tracking.

Government

Structured district-level verification, prioritization, assignment, and monitoring.

Universities

Real-world research and innovation opportunities for faculty, students, and researchers.

Industry

Opportunities for funding, mentorship, collaboration, and deployment support.

Communities

Better coordination between stakeholders for solving local problems.

🔮 Future Scope
Multilingual support
Advanced AI-based evidence validation
GIS-based problem heatmaps
Mobile application
Advanced analytics
Improved offline capabilities
More university-industry collaboration
Large-scale district deployment
Advanced solution recommendation
👨‍💻 Team
Team Innovate4India

Smart India Hackathon 2026

📌 Project Vision

"Local Problems. Shared Solutions."

Building a collaborative ecosystem where citizens identify problems, government verifies them, universities develop solutions, and industry helps take those solutions toward implementation.

📜 License

This project is developed as part of Smart India Hackathon 2026 by Team Innovate4India.
