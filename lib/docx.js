// Builds ATS-friendly Word (.docx) files from a generated result.
const { Document, Packer, Paragraph, TextRun, AlignmentType, LevelFormat, BorderStyle, TabStopType } = require('docx');
const JSZip = require('jszip');

const FONT = 'Calibri';
const ACCENT = '1F3864';
const A4 = { width: 11906, height: 16838 };
const RIGHT_TAB = 11906 - 720 * 2;

const arr = v => (Array.isArray(v) ? v.filter(Boolean) : []);

// [placeholders] are highlighted yellow so the user sees what to fill in.
function runs(text, o = {}) {
  return String(text ?? '').split(/(\[[^\]]+\])/g).filter(Boolean).map(p => new TextRun({
    text: p, font: FONT, size: o.size || 21, bold: o.bold, italics: o.italics, color: o.color,
    highlight: p.startsWith('[') ? 'yellow' : undefined,
  }));
}
const para = (t, o = {}) => new Paragraph({ alignment: o.align, spacing: { before: o.before || 0, after: o.after ?? 60, line: o.line || 264 }, children: runs(t, o) });
const heading = t => new Paragraph({
  spacing: { before: 200, after: 80 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 2 } },
  children: [new TextRun({ text: t.toUpperCase(), font: FONT, size: 23, bold: true, color: ACCENT })],
});
const bullet = (t, lead) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 }, spacing: { after: 40, line: 259 },
  children: [...(lead ? [new TextRun({ text: lead + ': ', font: FONT, size: 21, bold: true })] : []), ...runs(t)],
});
const twoSided = (left, right, o = {}) => new Paragraph({
  spacing: { before: o.before || 0, after: o.after || 0 }, tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
  children: [...runs(left, o), ...runs('\t' + (right || ''), { ...o, color: undefined })],
});

function makeDoc(children, margins) {
  return new Document({
    creator: 'JD Resume Tailor',
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
    sections: [{ properties: { page: { size: A4, margin: margins } }, children }],
  });
}

function resumeDoc(r) {
  const v = r.resume || {};
  const c = [];
  c.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: [new TextRun({ text: String(v.name || '').toUpperCase(), font: FONT, size: 40, bold: true, color: ACCENT })] }));
  if (v.headline) c.push(para(v.headline, { align: AlignmentType.CENTER, bold: true, size: 22, after: 40 }));
  if (v.contact) c.push(para(v.contact, { align: AlignmentType.CENTER, after: 80 }));
  if (v.summary) c.push(heading('Professional Summary'), para(v.summary));
  if (arr(v.competencies).length) { c.push(heading('Core Competencies')); v.competencies.forEach(x => c.push(bullet(x.items, x.label))); }
  if (arr(v.experience).length) {
    c.push(heading('Professional Experience'));
    v.experience.forEach(j => {
      c.push(twoSided(j.title, j.dates, { bold: true, size: 22, before: 140 }));
      c.push(twoSided(j.company, j.location, { italics: true, color: ACCENT, after: 60 }));
      if (j.intro) c.push(para(j.intro, { italics: true }));
      arr(j.bullets).forEach(b => c.push(bullet(b)));
    });
  }
  if (arr(v.achievements).length) { c.push(heading('Key Achievements')); v.achievements.forEach(b => c.push(bullet(b))); }
  if (arr(v.skills).length) { c.push(heading('Tools & Technologies')); v.skills.forEach(x => c.push(bullet(x.items, x.label))); }
  if (arr(v.education).length) {
    c.push(heading('Education'));
    v.education.forEach(e => {
      c.push(twoSided(e.degree, e.year, { bold: true, before: 60 }));
      const line = [e.school, e.detail].filter(Boolean).join('  |  ');
      if (line) c.push(para(line, { italics: true }));
    });
  }
  if (arr(v.certifications).length) { c.push(heading('Certifications')); v.certifications.forEach(b => c.push(bullet(b))); }
  if (arr(v.personal).length) { c.push(heading('Personal Details')); c.push(para(v.personal.join('  |  '))); }
  return makeDoc(c, { top: 720, bottom: 720, left: 720, right: 720 });
}

function letterHead(r) {
  const v = r.resume || {};
  return [
    new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: v.name || '', font: FONT, size: 32, bold: true, color: ACCENT })] }),
    para(v.contact || '', { after: 120, color: '595959' }),
    new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 4 } }, spacing: { after: 240 }, children: [] }),
  ];
}
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function coverDoc(r) {
  const cl = r.cover_letter || {};
  const c = [...letterHead(r)];
  c.push(para(today(), { after: 200, size: 22 }));
  if (r.company) c.push(para(r.company, { after: 0, size: 22 }));
  c.push(para('Re: Application for ' + (r.role_title || 'the advertised position'), { bold: true, size: 22, before: 160, after: 200 }));
  c.push(para(cl.greeting || 'Dear Hiring Manager,', { size: 22, after: 160 }));
  arr(cl.paragraphs).forEach(p => c.push(para(p, { size: 22, after: 160, line: 288, align: AlignmentType.JUSTIFIED })));
  c.push(para(cl.closing || 'Sincerely,', { size: 22, before: 120, after: 480 }));
  c.push(para(r.resume?.name || '', { size: 22, bold: true }));
  return makeDoc(c, { top: 1080, bottom: 1080, left: 1200, right: 1200 });
}

function textDoc(r, title, blocks) {
  const c = [...letterHead(r)];
  c.push(para(title, { size: 28, bold: true, color: ACCENT, after: 200 }));
  blocks.forEach(b => {
    if (b.label) c.push(para(b.label, { bold: true, size: 22, before: 160, after: 80, color: ACCENT }));
    String(b.text || '').split(/\n\s*\n/).forEach(p => c.push(new Paragraph({
      spacing: { after: 140, line: 288 },
      children: p.split('\n').flatMap((ln, i) => [...(i ? [new TextRun({ break: 1 })] : []), ...runs(ln, { size: 22 })]),
    })));
  });
  return makeDoc(c, { top: 1080, bottom: 1080, left: 1200, right: 1200 });
}

const emailDoc = r => textDoc(r, 'Application Email', [
  { label: 'Subject', text: r.email?.subject }, { label: 'Message', text: r.email?.body }]);
const introDoc = r => textDoc(r, 'Self-Introduction' + (r.role_title ? ' – ' + r.role_title : ''), [
  { label: '30-second version (networking / HR screening call)', text: r.intro_30 },
  { label: '60-second version ("Tell me about yourself")', text: r.intro_60 },
  { label: '2-minute version (hiring manager / panel interview)', text: r.intro_120 }]);

const BUILDERS = { resume: resumeDoc, cover: coverDoc, email: emailDoc, intro: introDoc };
const LABELS = { resume: 'Resume', cover: 'Cover_Letter', email: 'Application_Email', intro: 'Self_Introduction' };

const slug = s => String(s || '').replace(/\[[^\]]*\]/g, '').replace(/[^\w ]+/g, ' ').trim().replace(/\s+/g, '_').slice(0, 40);
function fileName(r, kind) {
  return [slug(r.resume?.name) || 'Candidate', LABELS[kind], slug(r.company)].filter(Boolean).join('_') + '.docx';
}

async function buildDocx(r, kind) {
  const b = BUILDERS[kind];
  if (!b) throw new Error('Unknown document type.');
  return Packer.toBuffer(b(r));
}


// ---------- interview Q&A ----------
function qaDoc(r, qa) {
  const c = [...letterHead(r)];
  c.push(para('Interview Questions & Model Answers' + (r.role_title ? ' – ' + r.role_title : ''), { size: 28, bold: true, color: ACCENT, after: 80 }));
  if (r.company) c.push(para(r.company, { italics: true, after: 200 }));
  let cat = '';
  arr(qa.questions).forEach((q, i) => {
    if (q.category !== cat) { cat = q.category; c.push(heading(cat)); }
    c.push(para(`Q${i + 1}. ${q.question}`, { bold: true, size: 22, before: 160, after: 40 }));
    c.push(para(`Difficulty: ${q.difficulty}${q.why ? '  |  What they test: ' + q.why : ''}`, { italics: true, color: '595959', size: 19, after: 60 }));
    c.push(para(q.answer, { size: 21, line: 276, after: 60 }));
    arr(q.key_points).forEach(k => c.push(bullet(k)));
    if (q.avoid) c.push(para('Avoid: ' + q.avoid, { italics: true, color: '9A5B00', size: 19, after: 80 }));
  });
  if (arr(qa.questions_to_ask).length) { c.push(heading('Questions to ask the interviewer')); qa.questions_to_ask.forEach(x => c.push(bullet(x))); }
  if (arr(qa.focus_areas).length) { c.push(heading('Topics to revise')); qa.focus_areas.forEach(x => c.push(bullet(x))); }
  return makeDoc(c, { top: 1000, bottom: 1000, left: 1100, right: 1100 });
}

// ---------- mock interview report ----------
const SCORE_LABELS = { communication: 'Communication', language: 'Language & grammar', domain_knowledge: 'Domain knowledge', relevance: 'Relevance to JD', structure: 'Answer structure', confidence: 'Confidence', conciseness: 'Conciseness' };
function practiceDoc(r, s) {
  const rep = s.report || {}, m = s.metrics || {};
  const c = [...letterHead(r)];
  c.push(para('Mock Interview Report' + (r.role_title ? ' – ' + r.role_title : ''), { size: 28, bold: true, color: ACCENT, after: 60 }));
  c.push(para(`${new Date(s.createdAt).toLocaleString('en-GB')}  |  ${s.settings?.type || ''} interview  |  ${s.settings?.difficulty || ''}`, { italics: true, color: '595959', after: 160 }));
  c.push(para(`Overall score: ${rep.overall_score}/100  —  ${rep.verdict}`, { bold: true, size: 26, after: 80 }));
  if (rep.summary) c.push(para(rep.summary, { size: 21, after: 120 }));
  c.push(heading('Scores'));
  Object.entries(SCORE_LABELS).forEach(([k, l]) => c.push(bullet(`${rep.scores?.[k] ?? '-'}/100`, l)));
  c.push(heading('Speaking metrics'));
  c.push(bullet(String(m.words_per_minute || 'n/a'), 'Speaking pace (words per minute)'));
  c.push(bullet(`${m.filler_words || 0} (${m.fillers_per_100_words || 0} per 100 words)`, 'Filler words'));
  c.push(bullet(`${m.avg_words_per_answer || 0} words, ${m.avg_answer_seconds || 0} seconds`, 'Average answer'));
  const lf = rep.language_feedback || {};
  if (arr(lf.grammar).length || arr(lf.vocabulary).length || lf.fluency) {
    c.push(heading('Language feedback'));
    if (lf.fluency) c.push(para(lf.fluency));
    arr(lf.grammar).forEach(x => c.push(bullet(x, 'Grammar')));
    arr(lf.vocabulary).forEach(x => c.push(bullet(x, 'Vocabulary')));
  }
  [['Strengths', rep.strengths], ['To improve', rep.improvements], ['Knowledge gaps to study', rep.knowledge_gaps], ['Next steps', rep.next_steps]]
    .forEach(([t, l]) => { if (arr(l).length) { c.push(heading(t)); l.forEach(x => c.push(bullet(x))); } });
  if (arr(rep.answers).length) {
    c.push(heading('Question-by-question feedback'));
    rep.answers.forEach((a, i) => {
      c.push(para(`Q${i + 1}. ${a.question}`, { bold: true, size: 22, before: 160, after: 40 }));
      c.push(para(`Score: ${a.score}/10`, { bold: true, color: ACCENT, after: 40 }));
      if (a.went_well) c.push(bullet(a.went_well, 'Went well'));
      if (a.improve) c.push(bullet(a.improve, 'Improve'));
      if (a.better_answer) c.push(para('Stronger answer: ' + a.better_answer, { italics: true, line: 276, after: 80 }));
    });
  }
  c.push(heading('Transcript'));
  arr(s.transcript).forEach(t => c.push(para(`${t.role === 'interviewer' ? 'Interviewer' : 'You'}: ${t.text}`, { bold: false, after: 80, color: t.role === 'interviewer' ? ACCENT : undefined })));
  return makeDoc(c, { top: 1000, bottom: 1000, left: 1100, right: 1100 });
}

async function buildQaDocx(r, qa) { return Packer.toBuffer(qaDoc(r, qa)); }
async function buildPracticeDocx(r, s) { return Packer.toBuffer(practiceDoc(r, s)); }

async function buildZip(r, qa) {
  const zip = new JSZip();
  for (const kind of Object.keys(BUILDERS)) zip.file(fileName(r, kind), await buildDocx(r, kind));
  if (qa && arr(qa.questions).length) zip.file(fileName(r, 'resume').replace('_Resume', '_Interview_QA'), await buildQaDocx(r, qa));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildDocx, buildZip, buildQaDocx, buildPracticeDocx, fileName, KINDS: Object.keys(BUILDERS) };
