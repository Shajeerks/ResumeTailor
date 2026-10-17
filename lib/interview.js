// Interview preparation: likely questions with model answers, a mock-interview agent and an evaluation report.
const ai = require('./ai');

const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };
const A = v => (Array.isArray(v) ? v.filter(x => x !== null && x !== undefined && x !== '') : []);
const num = (v, max = 100) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

const TYPES = {
  hr: 'an HR recruiter doing a screening call: motivation, background, communication, notice period, expectations, culture fit',
  manager: 'the hiring manager: depth of experience, ownership, stakeholder handling, results, how the candidate would do this job',
  technical: 'a domain / technical panel member: concepts, tools, methods and real scenarios from the job description',
  behavioural: 'a behavioural interviewer: past situations using STAR (situation, task, action, result), conflict, failure, leadership',
  mixed: 'a realistic full interview: a mix of HR, experience, domain and behavioural questions',
};
const LEVELS = { easy: 'friendly and supportive, simple questions', standard: 'professional, realistic difficulty', tough: 'demanding: probe vague answers, ask for numbers and specifics, challenge weak points' };

function context(rec) {
  const r = rec.result || {};
  return `ROLE: ${r.role_title || ''}
COMPANY: ${r.company || ''}
CANDIDATE NAME: ${r.resume?.name || ''}
KNOWN GAPS VS JD: ${A(r.missing_keywords).join(', ') || 'none listed'}

=== JOB DESCRIPTION ===
${clip(rec.input?.jdText, 7000)}

=== CANDIDATE RESUME ===
${clip(rec.input?.resumeText, 8000)}`;
}

// ---------- 1. Likely interview questions with model answers ----------
function qaPrompt(rec) {
  return `TASK: INTERVIEW_QA
You are a senior hiring manager and interview coach. Predict the questions this candidate is most likely to be asked for this job, and write strong model answers they can practise.

RULES
- 18 to 22 questions covering these categories: "Introduction & HR", "Role & Experience", "Technical / Domain", "Behavioural (STAR)", "Situational", "Gaps & Tricky", "Salary & Logistics".
- At least 5 Technical / Domain questions drawn from the job description's actual responsibilities, tools and skills.
- Include questions that probe the candidate's real gaps versus the JD, with honest answer strategies (never claim experience they lack).
- Model answers: first person, natural spoken style, 90-170 words, using ONLY facts from the resume. Behavioural answers follow STAR. Keep [bracketed placeholders] where a number or detail is unknown, e.g. [number of go-lives].
- "why": one sentence on what the interviewer is really testing.
- "key_points": 3-4 short bullet points to remember.
- "avoid": one common mistake to avoid.

Reply with ONLY valid JSON:
{"questions":[{"category":"","question":"","why":"","answer":"","key_points":[""],"avoid":"","difficulty":"Easy|Medium|Hard"}],
 "questions_to_ask":["5 thoughtful questions the candidate should ask the interviewer"],
 "focus_areas":["4-6 topics to revise before the interview"]}

${context(rec)}`;
}

function normaliseQA(d) {
  const qs = A(d.questions).map(q => ({
    category: q.category || 'General', question: q.question || '', why: q.why || '', answer: q.answer || '',
    key_points: A(q.key_points), avoid: q.avoid || '', difficulty: ['Easy', 'Medium', 'Hard'].includes(q.difficulty) ? q.difficulty : 'Medium',
  })).filter(q => q.question);
  return { questions: qs, questions_to_ask: A(d.questions_to_ask), focus_areas: A(d.focus_areas), createdAt: new Date().toISOString() };
}

async function generateQA({ provider, cfg, rec }) {
  if (provider === 'demo') return { ...demoQA(rec), sample: true };
  const { data } = await ai.runJson({ provider, cfg, prompt: qaPrompt(rec) });
  const qa = normaliseQA(data);
  if (!qa.questions.length) throw new Error('The AI did not return any questions. Please try again.');
  return qa;
}

// ---------- 2. Mock interview: one interviewer turn ----------
function turnPrompt(rec, s, transcript, mainAsked) {
  const lines = transcript.map(t => `${t.role === 'interviewer' ? 'INTERVIEWER' : 'CANDIDATE'}: ${t.text}`).join('\n');
  const mustClose = mainAsked >= s.length && transcript.length && transcript[transcript.length - 1].role === 'candidate';
  return `TASK: INTERVIEWER_TURN
You are ${TYPES[s.type] || TYPES.mixed}. You are interviewing the candidate below for this job, live, by voice. Style: ${LEVELS[s.difficulty] || LEVELS.standard}.

RULES
- Speak naturally as a human interviewer. One question at a time. Maximum 55 words. No lists, no markdown, no emojis.
- Total main questions for this interview: ${s.length}. Main questions asked so far: ${mainAsked}.
- If this is the start, greet the candidate by first name, introduce yourself in one short sentence as the interviewer from ${rec.result?.company || 'the company'}, then ask the first main question.
- After each candidate answer: if the answer is vague, very short or avoids the question, ask ONE follow-up (is_main_question false). Never ask more than one follow-up in a row. Otherwise briefly acknowledge (a few words, no praise inflation) and ask the next main question.
- Base questions on the job description and the candidate's resume. Do not repeat earlier questions.
- ${mustClose ? 'All main questions are done: thank the candidate, say what happens next, and close the interview. Set done to true.' : 'Do not close the interview yet; done must be false.'}
- ${s.mode === 'coach' ? '"tip": one short, specific coaching tip (max 25 words) on the candidate\'s LAST answer. Empty at the start.' : '"tip" must be an empty string (real interview mode).'}
- The candidate's words come from speech recognition and may contain transcription errors; interpret charitably.

Reply with ONLY valid JSON: {"say":"","is_main_question":true,"tip":"","done":false}

${context(rec)}

=== CONVERSATION SO FAR ===
${lines || '(interview not started)'}`;
}

async function interviewerTurn({ provider, cfg, rec, settings, transcript }) {
  const s = cleanSettings(settings);
  const tr = cleanTranscript(transcript);
  const mainAsked = tr.filter(t => t.role === 'interviewer' && t.main).length;
  if (provider === 'demo') return demoTurn(rec, s, tr, mainAsked);
  const { data } = await ai.runJson({ provider, cfg, prompt: turnPrompt(rec, s, tr, mainAsked) });
  const mustClose = mainAsked >= s.length && tr.length && tr[tr.length - 1].role === 'candidate';
  return {
    say: String(data.say || '').trim() || 'Could you tell me more about that?',
    is_main_question: mustClose ? false : data.is_main_question !== false,
    tip: s.mode === 'coach' ? String(data.tip || '') : '',
    done: mustClose ? true : !!data.done && mainAsked >= s.length,
  };
}

function cleanSettings(x = {}) {
  return {
    type: TYPES[x.type] ? x.type : 'mixed',
    length: Math.max(3, Math.min(12, parseInt(x.length, 10) || 6)),
    difficulty: LEVELS[x.difficulty] ? x.difficulty : 'standard',
    mode: x.mode === 'real' ? 'real' : 'coach',
  };
}
function cleanTranscript(t) {
  return A(t).slice(-60).map(x => ({
    role: x.role === 'candidate' ? 'candidate' : 'interviewer', text: clip(x.text, 4000), main: !!x.main,
    seconds: Number(x.seconds) || 0, words: Number(x.words) || 0, wpm: Number(x.wpm) || 0, fillers: Number(x.fillers) || 0,
  })).filter(x => x.text);
}

// ---------- 3. Evaluation ----------
function evalPrompt(rec, s, tr, metrics) {
  const lines = tr.map(t => t.role === 'interviewer' ? `INTERVIEWER: ${t.text}`
    : `CANDIDATE (${t.seconds}s, ${t.wpm} wpm, ${t.fillers} filler words): ${t.text}`).join('\n');
  return `TASK: INTERVIEW_EVALUATION
You are an expert interview coach and senior hiring manager. Evaluate this mock interview honestly and specifically, as if deciding whether to move the candidate forward.

Interview type: ${s.type}. Difficulty: ${s.difficulty}.
Speaking metrics measured by the app: ${JSON.stringify(metrics)}
Note: candidate text comes from speech recognition; ignore obvious transcription errors when judging grammar, but judge grammar and word choice that are clearly the candidate's.

SCORING (0-100 each): communication (clarity, flow, listening to the question), language (grammar, vocabulary, professional tone), domain_knowledge (accuracy and depth for this JD), relevance (answers linked to the JD's needs), structure (STAR, logical order, a clear point), confidence (assertive, ownership language, no hedging), conciseness (on point, ideal 60-120 seconds).
overall_score: weighted judgement, not a simple average. verdict: "Ready", "Almost ready" or "Needs more practice".
For each candidate answer to a question, give a 0-10 score, what went well, what to improve, and a better_answer (first person, 70-140 words, ONLY using facts from the resume; use [placeholders] for unknown numbers).

Reply with ONLY valid JSON:
{"overall_score":0,"verdict":"","summary":"2-3 sentences",
 "scores":{"communication":0,"language":0,"domain_knowledge":0,"relevance":0,"structure":0,"confidence":0,"conciseness":0},
 "language_feedback":{"grammar":["'what they said' -> 'better phrasing'"],"vocabulary":["tip"],"fluency":"one or two sentences on pace, fillers and flow"},
 "answers":[{"question":"","score":0,"went_well":"","improve":"","better_answer":""}],
 "strengths":[""],"improvements":[""],"knowledge_gaps":[""],"next_steps":["specific practice actions"]}

${context(rec)}

=== INTERVIEW TRANSCRIPT ===
${lines}`;
}

const SCORE_KEYS = ['communication', 'language', 'domain_knowledge', 'relevance', 'structure', 'confidence', 'conciseness'];
function normaliseEval(d) {
  const scores = {}; SCORE_KEYS.forEach(k => { scores[k] = num(d.scores?.[k]); });
  const overall = num(d.overall_score) || Math.round(SCORE_KEYS.reduce((a, k) => a + scores[k], 0) / SCORE_KEYS.length);
  const verdict = ['Ready', 'Almost ready', 'Needs more practice'].includes(d.verdict) ? d.verdict : overall >= 75 ? 'Ready' : overall >= 55 ? 'Almost ready' : 'Needs more practice';
  return {
    overall_score: overall, verdict, summary: d.summary || '', scores,
    language_feedback: { grammar: A(d.language_feedback?.grammar), vocabulary: A(d.language_feedback?.vocabulary), fluency: d.language_feedback?.fluency || '' },
    answers: A(d.answers).map(a => ({ question: a.question || '', score: num(a.score, 10), went_well: a.went_well || '', improve: a.improve || '', better_answer: a.better_answer || '' })),
    strengths: A(d.strengths), improvements: A(d.improvements), knowledge_gaps: A(d.knowledge_gaps), next_steps: A(d.next_steps),
  };
}

function computeMetrics(tr, durationSec) {
  const ans = tr.filter(t => t.role === 'candidate');
  const totalWords = ans.reduce((a, t) => a + (t.words || (t.text.match(/\S+/g) || []).length), 0);
  const spoken = ans.filter(t => t.seconds > 0);
  const speakSec = spoken.reduce((a, t) => a + t.seconds, 0);
  const spokenWords = spoken.reduce((a, t) => a + (t.words || 0), 0);
  return {
    answers: ans.length,
    total_words: totalWords,
    avg_words_per_answer: ans.length ? Math.round(totalWords / ans.length) : 0,
    avg_answer_seconds: spoken.length ? Math.round(speakSec / spoken.length) : 0,
    words_per_minute: speakSec > 5 ? Math.round(spokenWords / (speakSec / 60)) : 0,
    filler_words: ans.reduce((a, t) => a + (t.fillers || 0), 0),
    fillers_per_100_words: totalWords ? Math.round((ans.reduce((a, t) => a + (t.fillers || 0), 0) / totalWords) * 1000) / 10 : 0,
    duration_seconds: Math.round(Number(durationSec) || 0),
  };
}

async function evaluate({ provider, cfg, rec, settings, transcript, durationSec }) {
  const s = cleanSettings(settings);
  const tr = cleanTranscript(transcript);
  if (!tr.some(t => t.role === 'candidate')) throw new Error('Answer at least one question before ending, so there is something to evaluate.');
  const metrics = computeMetrics(tr, durationSec);
  let report;
  if (provider === 'demo') report = { ...demoEvaluate(tr, metrics), sample: true };
  else report = normaliseEval((await ai.runJson({ provider, cfg, prompt: evalPrompt(rec, s, tr, metrics) })).data);
  return { settings: s, transcript: tr, metrics, report };
}

// ---------- demo mode (free, no AI) ----------
function demoQA(rec) {
  const r = rec.result || {}, role = r.role_title || 'this role', co = r.company || 'your company';
  const gap = A(r.missing_keywords)[0] || 'a tool listed in the JD';
  const q = (category, question, difficulty, answer) => ({ category, question, difficulty,
    why: 'Sample: shows what the interviewer is checking.', answer, key_points: ['Lead with your most relevant experience', 'Give one concrete example', 'Link back to the role'], avoid: 'Reading your resume line by line.' });
  return normaliseQA({
    questions: [
      q('Introduction & HR', 'Tell me about yourself.', 'Easy', `Sample answer. I am a professional with experience that matches ${role}. I would walk through my current role, my key achievement and why this role at ${co} is my next step.`),
      q('Introduction & HR', `Why do you want to join ${co}?`, 'Easy', 'Sample answer. Connect the company’s work to your experience and your goals.'),
      q('Role & Experience', 'Walk me through a project you led from start to finish.', 'Medium', 'Sample answer using STAR: situation, task, actions and a measurable result.'),
      q('Technical / Domain', 'How do you gather requirements and handle changes in scope?', 'Medium', 'Sample answer. Describe your requirement process, BRD sign-off and change control.'),
      q('Technical / Domain', 'How do you plan and run user acceptance testing?', 'Medium', 'Sample answer. Explain test scenarios, user sign-off and defect triage.'),
      q('Behavioural (STAR)', 'Tell me about a time you handled a difficult client.', 'Medium', 'Sample STAR answer with a calm, solution-focused outcome.'),
      q('Situational', 'A go-live date is at risk. What do you do?', 'Hard', 'Sample answer. Assess impact, inform stakeholders early, re-plan and protect critical scope.'),
      q('Gaps & Tricky', `The JD asks for ${gap}. How would you handle that?`, 'Hard', `Sample answer. Be honest that ${gap} is new to you, show a similar skill you have and your plan to learn it.`),
      q('Salary & Logistics', 'What are your salary expectations and notice period?', 'Easy', 'Sample answer. Give a researched range [range] and your notice period [days].'),
    ],
    questions_to_ask: ['How is success measured in the first 90 days?', 'What are the biggest challenges for the team right now?', 'How is the team structured?'],
    focus_areas: ['Your 2-minute introduction', 'Two STAR stories with numbers', gap],
  });
}

const DEMO_QS = ['Tell me about yourself and your current role.', 'Describe a project you delivered end to end. What was your role?',
  'How do you handle a client who keeps changing requirements?', 'Tell me about a time a deadline was at risk. What did you do?',
  'How do you track progress and report status to leadership?', 'What is your biggest weakness for this role?',
  'How do you motivate a team under pressure?', 'Why should we hire you?', 'Where do you see yourself in three years?',
  'What would you do in your first 90 days here?', 'How do you prioritise competing requests?', 'Do you have any questions for us?'];
function demoTurn(rec, s, tr, mainAsked) {
  const name = String(rec.result?.resume?.name || '').split(/\s+/)[0] || 'there';
  const last = tr[tr.length - 1];
  const tip = s.mode === 'coach' && last?.role === 'candidate'
    ? (last.words < 40 ? 'Sample tip: add a concrete example with a number.' : 'Sample tip: finish with the result and what you learned.') : '';
  if (mainAsked >= s.length && last?.role === 'candidate') return { say: 'Thank you, that is all from my side. We will share feedback soon. This was a demo interview.', is_main_question: false, tip, done: true };
  const qs = A(rec.qa?.questions).map(q => q.question);
  const question = (qs.length >= s.length ? qs : DEMO_QS)[mainAsked % (qs.length >= s.length ? qs.length : DEMO_QS.length)];
  const say = mainAsked === 0 ? `Hello ${name}, thanks for joining. I am the interviewer for this demo session. ${question}` : `Thank you. ${question}`;
  return { say, is_main_question: true, tip, done: false };
}
function demoEvaluate(tr, m) {
  const fill = Math.min(30, m.fillers_per_100_words * 4);
  const len = m.avg_words_per_answer;
  const base = Math.max(35, Math.min(85, 50 + Math.min(25, len / 4) - fill));
  const q = tr.filter(t => t.role === 'interviewer' && t.main);
  const answers = [];
  tr.forEach((t, i) => { if (t.role === 'candidate') { const prev = [...tr.slice(0, i)].reverse().find(x => x.role === 'interviewer'); answers.push({ question: prev?.text || '', score: Math.max(3, Math.min(9, Math.round(t.words / 15) + 3)), went_well: 'Sample: you answered the question directly.', improve: 'Sample: add one specific example with a measurable result.', better_answer: 'Sample better answer. Real feedback appears when a real AI is connected in Settings.' }); } });
  return normaliseEval({
    overall_score: Math.round(base), summary: `Sample evaluation of ${answers.length} answers (${q.length} questions). Connect Gemini or Claude for a real assessment.`,
    scores: { communication: base + 4, language: base + 2, domain_knowledge: base - 3, relevance: base, structure: base - 5, confidence: base + 1, conciseness: len > 180 ? base - 15 : base + 3 },
    language_feedback: { grammar: [], vocabulary: ['Sample: use action verbs such as led, delivered, resolved.'], fluency: `You used ${m.filler_words} filler words at about ${m.words_per_minute || 'n/a'} words per minute.` },
    answers, strengths: ['Sample: clear introduction'], improvements: ['Sample: use STAR for behavioural answers'], knowledge_gaps: [], next_steps: ['Practise two STAR stories out loud', 'Record yourself and cut filler words'],
  });
}

module.exports = { generateQA, interviewerTurn, evaluate, computeMetrics, SCORE_KEYS };
