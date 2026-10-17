// Extracts plain text from an uploaded resume (.docx, .pdf, .txt, .md)
const mammoth = require('mammoth');
// Require the inner module directly: the package index runs a debug self-test that crashes.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

function clean(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractText(file) {
  const name = (file.originalname || '').toLowerCase();
  let text = '';
  if (name.endsWith('.docx')) {
    text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
  } else if (name.endsWith('.pdf')) {
    text = (await pdfParse(file.buffer)).text;
  } else if (name.endsWith('.txt') || name.endsWith('.md')) {
    text = file.buffer.toString('utf8');
  } else if (name.endsWith('.doc')) {
    throw new Error('Old .doc files are not supported. Open it in Word, choose Save As > .docx, and upload again.');
  } else {
    throw new Error('Unsupported file type. Upload a .docx, .pdf or .txt file.');
  }
  text = clean(text);
  if (text.length < 150) {
    throw new Error('Very little text was found in this file. If it is a scanned PDF, paste the resume text instead.');
  }
  return text;
}

module.exports = { extractText };
