/** Rich, realistic (fake) deployment for the user-manual screenshots — emulator. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
import { EMULATOR_PORTS } from './lib/ports.mjs';
import { EMULATOR_PROJECT_ID, EMULATOR_STORAGE_BUCKET } from './lib/project.mjs';
process.env.FIRESTORE_EMULATOR_HOST=`127.0.0.1:${EMULATOR_PORTS.firestore}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST=`127.0.0.1:${EMULATOR_PORTS.auth}`;
process.env.FIREBASE_STORAGE_EMULATOR_HOST=`127.0.0.1:${EMULATOR_PORTS.storage}`;
admin.initializeApp({ projectId: EMULATOR_PROJECT_ID, storageBucket: EMULATOR_STORAGE_BUCKET });
const auth=admin.auth(), db=admin.firestore();
const now=Date.now(), day=86400000;
const iso=(ms)=>new Date(ms).toISOString().slice(0,10);

// ---- students ----
const NAMES=['Fatima Ahmed','Bilal Khan','Omar Siddiqui','Ayesha Rahman','Yusuf Ali','Maryam Iqbal','Zainab Hassan','Ibrahim Malik'];
const students=[];
// The last one is DISABLED, so the Students screen has something in its
// "Disabled" section to photograph — an empty collapsible documents nothing.
for (const name of NAMES){
  const email=name.toLowerCase().replace(/ /g,'.')+'@example.com';
  const status = name===NAMES[NAMES.length-1] ? 'disabled' : 'active';
  let u; try { u=await auth.getUserByEmail(email); } catch { u=await auth.createUser({ email, displayName:name }); }
  await new Promise(r=>setTimeout(r,300));
  await auth.setCustomUserClaims(u.uid,{ role:'student', status });
  await db.collection('students').doc(u.uid).set({ email, displayName:name, role:'student', status, createdAt:now-40*day, createdBy:'seed' });
  students.push({ uid:u.uid, name, email });
}
// Fatima gets a password so she can be shown signing in for the STUDENT screenshots.
await auth.updateUser(students[0].uid,{ password:'HikamStudent1', emailVerified:true });

// ---- cohort + courses ----
const cohortId='guide-cohort';
await db.collection('cohorts').doc(cohortId).set({ name:'Autumn 2026', archived:false, createdAt:now-45*day, createdBy:'seed' });
// A finished term, so the cohort list has an "Archived" section to show. Its
// course carries effectiveActive:false, which is what the cascade would leave.
await db.collection('cohorts').doc('guide-cohort-past').set({ name:'Spring 2026', archived:true, createdAt:now-220*day, createdBy:'seed' });
await db.collection('courses').doc('guide-past-course').set({ cohortId:'guide-cohort-past', name:'Seerah Survey', archived:false, effectiveActive:false, archivedAccess:false, managerUids:[], createdAt:now-220*day, createdBy:'seed' });
const courses={
  hikam:{ id:'guide-hikam', name:'Hikam Foundations' },
  arabic:{ id:'guide-arabic', name:'Arabic I' },
};
for (const c of Object.values(courses))
  await db.collection('courses').doc(c.id).set({ cohortId, name:c.name, archived:false, effectiveActive:true, archivedAccess:false, managerUids:[], createdAt:now-45*day, createdBy:'seed' });
// enroll all 8 in Hikam; first 4 also in Arabic
for (const s of students) await db.collection('enrollments').doc(`${s.uid}_${courses.hikam.id}`).set({ studentUid:s.uid, courseId:courses.hikam.id, cohortId, active:true, enrolledAt:now-40*day, enrolledBy:'seed' });
for (const s of students.slice(0,4)) await db.collection('enrollments').doc(`${s.uid}_${courses.arabic.id}`).set({ studentUid:s.uid, courseId:courses.arabic.id, cohortId, active:true, enrolledAt:now-40*day, enrolledBy:'seed' });

// ---- sessions + their recordings: attendance-driven ----
const audio=readFileSync('e2e-shots/test-lecture.m4a');
const uids=students.map(s=>s.uid);
// Attendance snapshot: the first `present` of `who` are present, the rest EXCUSED
// — excused is the only mark that grants the recording, so a seed that defaulted
// to absent would photograph every student screen empty. `absent` names the
// unexcused, who get nothing and exist here to populate the ledger's own section.
const attend=(present, {excused=[], absent=[], who=uids}={})=>Object.fromEntries(who.map((u,i)=>{
  if (absent.includes(u)) return [u,'absent'];
  if (excused.includes(u)) return [u,'excused'];
  return [u, i<present?'present':'excused'];
}));

async function mkSession(courseId, sid, rid, title, { status='published', dueOffset=7, daysAgo=7, notes='', attendance=null, attention=null }={}){
  const date=iso(now-daysAgo*day);
  // Never null: the due date is the day access closes, so a session cannot be
  // without one.
  const dueDate=iso(now+dueOffset*day);
  const hasAudio = status!=='draft';
  const path=`recordings/${rid}/audio.m4a`;
  if (hasAudio) await admin.storage().bucket().file(path).save(audio,{contentType:'audio/mp4'});
  const submitted = attendance ? now-daysAgo*day : null;
  await db.collection('sessions').doc(sid).set({
    courseId, cohortId, date, title, dueDate, notes,
    recordingId: rid, attendance: attendance??{}, attendanceSubmittedAt: submitted,
    archived:false, createdAt:now-daysAgo*day, createdBy:'seed', updatedAt:now-daysAgo*day,
  });
  await db.collection('recordings').doc(rid).set({
    sessionId:sid, courseId, cohortId, title, notes, date, status, source:'manual',
    audioPath:hasAudio?path:null, durationSec:hasAudio?720:null, sizeBytes:hasAudio?audio.length:null,
    createdAt:now-daysAgo*day, createdBy:'seed', updatedAt:now-daysAgo*day,
    ...(status==='published'?{publishedAt:now-daysAgo*day}:{}),
    ...(attention?{attentionReason:attention}:{}),
  });
  // Fan out grants to the EXCUSED (only once published AND attendance taken).
  if (status==='published' && attendance){
    for (const [uid,st] of Object.entries(attendance)){
      if (st==='excused'){
        await db.collection('assignments').doc(`${uid}_${rid}`).set({ studentUid:uid, recordingId:rid, sessionId:sid, courseId, cohortId, dueDate, active:true, assignedAt:submitted, assignedBy:'system' });
      }
    }
  }
  return rid;
}
const H=courses.hikam.id;
// Hikam: attendance taken, most present, the rest excused (and so granted the
// recording). One genuinely unexcused absence, for the ledger's Absent section.
await mkSession(H,'g-s1','g-s1r','Session 1 — Introduction to the Hikam', {dueOffset:-14, daysAgo:21, attendance:attend(6, {absent:[uids[6]]})});
// Fatima (uids[0], the demo student) was excused from sessions 2 and 3, so she
// has real required listening on the student screenshots: s2 missed, s3 due-soon
// (60% listened).
await mkSession(H,'g-s2','g-s2r','Session 2 — Knowledge and Certainty', {dueOffset:-6, daysAgo:14, attendance:attend(4, {excused:[uids[0]]})});
await mkSession(H,'g-s3','g-s3r','Session 3 — Patience in Hardship', {dueOffset:3, daysAgo:5, notes:'Focus on the section about gratitude in hardship — we will discuss it next week.', attendance:attend(5, {excused:[uids[0]]})});
await mkSession(H,'g-s4','g-s4r','Session 4 — Sincerity of Intention', {dueOffset:5, daysAgo:2, attendance:attend(6)});
// Session 5: recording published but attendance NOT taken yet — nobody assigned.
await mkSession(H,'g-s5','g-s5r','Session 5 — Reliance and Trust', {status:'published', daysAgo:1, attendance:null});
// Session 6: a Zoom import that needs review.
await mkSession(H,'g-s6','g-s6r','Session 6 — (import needs review)', {status:'needsAttention', daysAgo:1, attention:'Audio file looks truncated — re-upload before publishing.'});
// Session 7: attendance taken TODAY, recording not added yet.
await db.collection('sessions').doc('g-s7').set({ courseId:H, cohortId, date:iso(now), title:'Session 7 — Today (recording pending)', dueDate:iso(now+7*day), notes:'', recordingId:null, attendance:attend(5), attendanceSubmittedAt:now, archived:false, createdAt:now, createdBy:'seed', updatedAt:now });
// Arabic I: two published sessions.
// Only the first four students are enrolled in Arabic, so its snapshot covers
// only them — a mark for someone off the roster would be dropped on submit.
const arabicUids=uids.slice(0,4);
await mkSession(courses.arabic.id,'g-a1','g-a1r','Lesson 1 — The Arabic Alphabet', {dueOffset:-2, daysAgo:9, attendance:attend(3,{who:arabicUids})});
await mkSession(courses.arabic.id,'g-a2','g-a2r','Lesson 2 — Short Vowels', {dueOffset:5, daysAgo:4, attendance:attend(2,{who:arabicUids})});

// ---- completions / progress: a realistic mix over the accountable (absent) set ----
async function complete(uid, rid, listenedFrac=1){
  await db.collection('completions').doc(`${uid}_${rid}`).set({ studentUid:uid, recordingId:rid, courseId:H, completed:true, completedAt:now-2*day, updatedAt:now-2*day });
  await db.collection('listeningProgress').doc(`${uid}_${rid}`).set({ studentUid:uid, recordingId:rid, courseId:H, positionMs:720000*listenedFrac, listenedMs:720000*listenedFrac, updatedAt:now-2*day });
}
async function progressOnly(uid, rid, frac){
  await db.collection('listeningProgress').doc(`${uid}_${rid}`).set({ studentUid:uid, recordingId:rid, courseId:H, positionMs:720000*frac, listenedMs:720000*frac, updatedAt:now-3*day });
}
// s1 (g-s1r): 7 is excused, 6 was absent and gets nothing. The excused one caught up.
await complete(uids[7],'g-s1r');
// s2 (g-s2r): excused are 0 and 4..7. Two completed, one part-way, and Fatima
// never started — so she is Missed, past the deadline.
await complete(uids[4],'g-s2r'); await complete(uids[5],'g-s2r');
await progressOnly(uids[6],'g-s2r',0.5);
// s3 (g-s3r): excused are 0 and 5..7. One completed; Fatima is 60% through,
// still ahead of the deadline.
await complete(uids[5],'g-s3r');
await progressOnly(uids[0],'g-s3r',0.6);
// One staff override with a reason (student 6 on s2r).
await db.collection('completionOverrides').doc(`${uids[6]}_g-s2r`).set({ studentUid:uids[6], recordingId:'g-s2r', courseId:H, completed:true, reason:'Attended part of the class in person; caught up on the rest.', overriddenBy:'seed-admin', at:now-1*day });

// ---- audit log: realistic recent history ----
const A=(action,detail,extra={})=>({ at:now-(Math.random()*3*day), actorUid:'seed-admin', actorRole:'admin', action, courseId:H, targets:extra, ...(detail?{detail}:{}) });
const auditEntries=[
  A('overrideCompletion',{completed:true, reason:'Attended part of the class in person.'},{recordingId:'g-s2r', studentUid:uids[6]}),
  A('submitAttendance',null,{sessionId:'g-s4'}),
  A('setRecordingStatus',{status:'published'},{recordingId:'g-s4r'}),
  A('createSession',null,{sessionId:'g-s4'}),
  A('createStudent',null,{uid:uids[7]}),
  A('createEnrollment',null,{studentUid:uids[7]}),
];
for (const e of auditEntries) await db.collection('auditLog').add(e);
await db.collection('auditLog').add({ at:now-2*day, actorUid:'seed-admin', actorRole:'admin', action:'createCohort', courseId:null, targets:{cohortId} });

console.log(JSON.stringify({ studentEmail:students[0].email, studentPw:'HikamStudent1', hikamCourseId:courses.hikam.id, managerUidNeeded:true }, null, 0));
