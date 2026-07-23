/** Rich, realistic (fake) deployment for the user-manual screenshots — emulator. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST='127.0.0.1:9199';
admin.initializeApp({ projectId:'demo-sabeel', storageBucket:'demo-sabeel.appspot.com' });
const auth=admin.auth(), db=admin.firestore();
const now=Date.now(), day=86400000;
const iso=(ms)=>new Date(ms).toISOString().slice(0,10);

// ---- students ----
const NAMES=['Fatima Ahmed','Bilal Khan','Omar Siddiqui','Ayesha Rahman','Yusuf Ali','Maryam Iqbal','Zainab Hassan','Ibrahim Malik'];
const students=[];
for (const name of NAMES){
  const email=name.toLowerCase().replace(/ /g,'.')+'@example.com';
  let u; try { u=await auth.getUserByEmail(email); } catch { u=await auth.createUser({ email, displayName:name }); }
  await new Promise(r=>setTimeout(r,300));
  await auth.setCustomUserClaims(u.uid,{ role:'student', status:'active' });
  await db.collection('students').doc(u.uid).set({ email, displayName:name, role:'student', status:'active', createdAt:now-40*day, createdBy:'seed' });
  students.push({ uid:u.uid, name, email });
}
// Fatima gets a password so she can be shown signing in for the STUDENT screenshots.
await auth.updateUser(students[0].uid,{ password:'HikamStudent1', emailVerified:true });

// ---- cohort + classes ----
const cohortId='guide-cohort';
await db.collection('cohorts').doc(cohortId).set({ name:'Autumn 2026', archived:false, createdAt:now-45*day, createdBy:'seed' });
const classes={
  hikam:{ id:'guide-hikam', name:'Hikam Foundations' },
  arabic:{ id:'guide-arabic', name:'Arabic I' },
};
for (const c of Object.values(classes))
  await db.collection('classes').doc(c.id).set({ cohortId, name:c.name, archived:false, effectiveActive:true, archivedAccess:false, managerUids:[], createdAt:now-45*day, createdBy:'seed' });
// enroll all 8 in Hikam; first 4 also in Arabic
for (const s of students) await db.collection('enrollments').doc(`${s.uid}_${classes.hikam.id}`).set({ studentUid:s.uid, classId:classes.hikam.id, cohortId, active:true, enrolledAt:now-40*day, enrolledBy:'seed' });
for (const s of students.slice(0,4)) await db.collection('enrollments').doc(`${s.uid}_${classes.arabic.id}`).set({ studentUid:s.uid, classId:classes.arabic.id, cohortId, active:true, enrolledAt:now-40*day, enrolledBy:'seed' });

// ---- recordings (Hikam): a mix of statuses + due dates ----
const audio=readFileSync('e2e-shots/test-lecture.m4a');
async function rec(id, title, {status='published', dueOffset=null, recordedDaysAgo=7, attention=null}={}){
  const path=`recordings/${id}/audio.m4a`;
  if (status!=='draft'){ await admin.storage().bucket().file(path).save(audio,{ contentType:'audio/mp4' }); }
  const dueDate = dueOffset===null ? null : iso(now+dueOffset*day);
  await db.collection('recordings').doc(id).set({
    cohortId, classId:classes.hikam.id, title, status, source:'manual',
    recordedAt: now-recordedDaysAgo*day, dueDate, notes: title.includes('Patience')?'Focus on the section about gratitude in hardship — we will discuss it next week.':'',
    audioPath: status==='draft'?null:path, durationSec: status==='draft'?null:720, sizeBytes: status==='draft'?null:audio.length,
    createdAt: now-recordedDaysAgo*day, createdBy:'seed', updatedAt: now-recordedDaysAgo*day,
    ...(status==='published'?{publishedAt:now-recordedDaysAgo*day}:{}),
    ...(attention?{attentionReason:attention}:{}),
  });
  return id;
}
const R={};
R.s1=await rec('g-s1','Session 1 — Introduction to the Hikam', {dueOffset:-14, recordedDaysAgo:21});
R.s2=await rec('g-s2','Session 2 — Knowledge and Certainty', {dueOffset:-6, recordedDaysAgo:14});
R.s3=await rec('g-s3','Session 3 — Patience in Hardship', {dueOffset:3, recordedDaysAgo:5});
R.s4=await rec('g-s4','Session 4 — Sincerity of Intention', {dueOffset:null, recordedDaysAgo:2});
R.s5=await rec('g-s5','Session 5 — Reliance and Trust', {status:'draft', recordedDaysAgo:0});
R.s6=await rec('g-s6','Session 6 — (import needs review)', {status:'needsAttention', recordedDaysAgo:1, attention:'Audio file looks truncated — re-upload before publishing.'});
// Arabic I: two published
async function recIn(cls, id, title, dueOffset){ const path=`recordings/${id}/audio.m4a`; await admin.storage().bucket().file(path).save(audio,{contentType:'audio/mp4'}); await db.collection('recordings').doc(id).set({ cohortId, classId:cls, title, status:'published', source:'manual', recordedAt:now-7*day, dueDate: dueOffset===null?null:iso(now+dueOffset*day), notes:'', audioPath:path, durationSec:720, sizeBytes:audio.length, createdAt:now-7*day, createdBy:'seed', updatedAt:now-7*day, publishedAt:now-7*day }); }
await recIn(classes.arabic.id,'g-a1','Lesson 1 — The Arabic Alphabet', -2);
await recIn(classes.arabic.id,'g-a2','Lesson 2 — Short Vowels', 5);

// ---- assignments (publish fan-out, done directly) for published Hikam sessions ----
const publishedHikam=[['g-s1',-14],['g-s2',-6],['g-s3',3],['g-s4',null]];
for (const s of students){
  for (const [rid,due] of publishedHikam){
    await db.collection('assignments').doc(`${s.uid}_${rid}`).set({ studentUid:s.uid, recordingId:rid, classId:classes.hikam.id, cohortId, dueDate: due===null?null:iso(now+due*day), source:'publish', active:true, assignedAt:now-10*day, assignedBy:'system' });
  }
}

// ---- completions / progress / overrides: a realistic mix ----
async function complete(uid, rid, cls, listenedFrac=1){
  await db.collection('completions').doc(`${uid}_${rid}`).set({ studentUid:uid, recordingId:rid, classId:cls, completed:true, completedAt:now-2*day, updatedAt:now-2*day });
  await db.collection('listeningProgress').doc(`${uid}_${rid}`).set({ studentUid:uid, recordingId:rid, classId:cls, positionMs:720000*listenedFrac, listenedMs:720000*listenedFrac, updatedAt:now-2*day });
}
async function progressOnly(uid, rid, cls, frac){
  await db.collection('listeningProgress').doc(`${uid}_${rid}`).set({ studentUid:uid, recordingId:rid, classId:cls, positionMs:720000*frac, listenedMs:720000*frac, updatedAt:now-3*day });
}
// Most students completed s1 & s2 (the overdue ones); a few didn't (=> overdue rows).
for (let i=0;i<students.length;i++){
  const s=students[i];
  // s1: everyone except the last 2 completed
  if (i<6) await complete(s.uid,'g-s1',classes.hikam.id);
  else await progressOnly(s.uid,'g-s1',classes.hikam.id,0.3);
  // s2: about half completed
  if (i%2===0) await complete(s.uid,'g-s2',classes.hikam.id); else await progressOnly(s.uid,'g-s2',classes.hikam.id,0.5);
  // s3 (due soon): Fatima part-listened, a couple completed
  if (i===0) await progressOnly(s.uid,'g-s3',classes.hikam.id,0.4);
  else if (i<3) await complete(s.uid,'g-s3',classes.hikam.id);
}
// Fatima completed s4 (no-due) — shows a Completed item on her home.
await complete(students[0].uid,'g-s4',classes.hikam.id);
// One staff override with a reason (Ibrahim on s2 — attended live).
await db.collection('completionOverrides').doc(`${students[7].uid}_g-s2`).set({ studentUid:students[7].uid, recordingId:'g-s2', classId:classes.hikam.id, completed:true, reason:'Attended the class live; confirmed with the teacher.', overriddenBy:'seed-admin', at:now-1*day });

// ---- audit log: realistic recent history ----
const A=(action,detail,extra={})=>({ at:now-(Math.random()*3*day), actorUid:'seed-admin', actorRole:'admin', action, classId:classes.hikam.id, targets:extra, ...(detail?{detail}:{}) });
const auditEntries=[
  A('overrideCompletion',{completed:true, reason:'Attended the class live; confirmed with the teacher.'},{recordingId:'g-s2', studentUid:students[7].uid}),
  A('setRecordingStatus',{status:'published'},{recordingId:'g-s4'}),
  A('createRecording',null,{recordingId:'g-s4'}),
  A('updateRecording',null,{recordingId:'g-s3'}),
  A('assignCatchup',{dueDate:iso(now+7*day)},{recordingId:'g-s1', studentUid:students[6].uid}),
  A('createStudent',null,{uid:students[7].uid}),
  A('createEnrollment',null,{studentUid:students[7].uid}),
];
for (const e of auditEntries) await db.collection('auditLog').add(e);
// a couple of class-less (admin-only) entries
await db.collection('auditLog').add({ at:now-2*day, actorUid:'seed-admin', actorRole:'admin', action:'createCohort', classId:null, targets:{cohortId} });

console.log(JSON.stringify({ studentEmail:students[0].email, studentPw:'HikamStudent1', hikamClassId:classes.hikam.id, managerUidNeeded:true }, null, 0));
