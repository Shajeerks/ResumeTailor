# JD Resume Tailor

Upload a resume, paste a job description and get:

- an ATS match report (score, matched and missing keywords, gaps, tips)
- a tailored ATS-friendly resume (.docx)
- a cover letter (.docx)
- an application email (.docx)
- 30-second, 60-second and 2-minute self-introductions (.docx)
- everything together as one .zip
- **Interview Q&A**: 18–22 likely questions with model answers from your own resume, what each question tests, key points, mistakes to avoid, questions to ask the interviewer and topics to revise. Tick questions as prepared; download as Word.
- **Interview practice**: a voice mock interview with an AI interviewer (HR, hiring manager, technical, behavioural or mixed; friendly, realistic or tough; coach or real mode). Your audio is recorded, and you get a scored report: communication, language and grammar, domain knowledge, relevance, structure, confidence, conciseness, speaking pace and filler words, question-by-question feedback with stronger answers, and next steps. A readiness score and trend chart track your progress.

Runs on your own computer at **http://localhost:3020** (ports 3000 and 3010 are left free for your other apps).

## First-time setup (Mac)

1. Check Node.js in Terminal: `node -v` (needs 18 or newer). If missing, install the LTS version from https://nodejs.org.
2. The app lives in `~/HIS/HIS-upload/jd-resume-tailor` (already installed, components included).
3. In Terminal:
   ```
   cd ~/HIS/HIS-upload/jd-resume-tailor
   npm start
   ```
4. Open http://localhost:3020. The app starts in **Demo mode** (free sample answers).
5. For real output, go to **Settings** and pick an AI (see below).

## Choosing the AI (Settings page)

| Option | Cost | Use it for |
|---|---|---|
| Demo mode | Free | Trying the screens. Output is a fixed sample, not based on your resume |
| Google Gemini | Free tier | Testing with real tailored output. Get a key at aistudio.google.com > Get API key (no card needed) |
| Anthropic Claude | Paid (about ₹5–12 per application) | Best writing quality. Key from console.anthropic.com |
| Ollama | Free, offline | Fully private on your Mac. Install from ollama.com, then `ollama pull llama3.1:8b`. Slower |

You can switch at any time. Saved keys are kept when you switch.

## Everyday use

```
cd ~/HIS/HIS-upload/jd-resume-tailor && npm start
```
or double-click `start.command` (the first time: right-click it > Open, because macOS blocks downloaded scripts).

Stop the app with **Ctrl + C** in the Terminal window.

## Always-demo start

```
npm run demo
```
Forces demo mode regardless of Settings (useful for showing the app without using any key).

## Voice interview tips

- Use **Chrome, Edge or Safari** on the Mac running the app, at **http://localhost:3020**. Allow the microphone when asked.
- Use headphones so the microphone does not hear the interviewer's voice.
- Speech-to-text uses the browser's service and needs internet. Firefox has no speech recognition: type your answers there.
- On other devices (http://192.168…:3020) browsers block the microphone, so friends type their answers there.
- Recordings are saved in `data/audio/`. Delete a session from the Practice sessions list to remove its recording.

## Letting friends use it

- **Same Wi-Fi / office network:** start the app and share the "On your Wi-Fi/LAN" address printed in Terminal (for example http://192.168.1.20:3020). Your Mac must stay on and awake.
- Their generations use your selected AI and key, and appear in your History. Delete them from History when done.
- To keep it private to your Mac only, set `HOST=127.0.0.1` in `.env`.

## Settings file (.env)

| Setting | Meaning |
|---|---|
| AI_PROVIDER | demo, gemini, anthropic or ollama (set by the Settings page) |
| GEMINI_API_KEY / GEMINI_MODEL | Free Google Gemini key and model |
| ANTHROPIC_API_KEY / CLAUDE_MODEL | Paid Anthropic key and model |
| OLLAMA_URL / OLLAMA_MODEL | Local Ollama address and model |
| PORT | Default 3020. Change it if that port is busy |
| HOST | 0.0.0.0 = available on your network, 127.0.0.1 = this Mac only |

## Where things are stored

- Generated applications, interview questions and practice reports: `data/history/` (one file each). Delete them from the History page.
- Interview audio recordings: `data/audio/`.
- API key: `.env` in this folder. Never share this file.

## Troubleshooting

| Message | Fix |
|---|---|
| Port 3020 is already in use | Add `PORT=3030` to `.env` and start again |
| Your API key was rejected | Create a new key (aistudio.google.com or console.anthropic.com) and save it in Settings |
| Gemini free-tier limit reached | Wait a minute, or until the next day for the daily limit |
| No credit left (Claude) | console.anthropic.com > Billing > add credit, or switch to Gemini |
| Ollama is not running | Open the Ollama app, then try again |
| Very little text was found | The PDF is a scanned image. Paste the resume text instead |
| Old .doc files are not supported | Open it in Word > Save As > .docx |
