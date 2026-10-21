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

Every user signs in with their own account (email and mobile number are mandatory) and sees only their own applications, interview reports and recordings. Each user adds their own AI key in **AI settings**; keys are encrypted.

Runs on your own computer at **http://localhost:3020** (ports 3000 and 3010 are left free for your other apps), or online on **Vercel** with a free **Supabase** database (see "Put it online" below).

## First-time setup (Mac)

1. Check Node.js in Terminal: `node -v` (needs 18 or newer). If missing, install the LTS version from https://nodejs.org.
2. The app lives in `~/HIS/HIS-upload/jd-resume-tailor` (already installed, components included).
3. In Terminal:
   ```
   cd ~/HIS/HIS-upload/jd-resume-tailor
   npm start
   ```
4. Open http://localhost:3020 and **Create account** (name, email, mobile number, password).
   The first account created on this computer takes over the applications and AI keys saved before sign-in was added.
5. New accounts start in **Demo mode** (free sample answers). For real output, open **AI settings** and pick an AI (see below).

## Choosing the AI (AI settings page)

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

## Put it online (Vercel + Supabase, free)

Vercel cannot keep files, so the online version stores accounts, applications and recordings in Supabase.

1. **Supabase:** sign up at supabase.com > New project (any name, choose a strong database password, region Mumbai/Singapore).
2. In the project: **SQL Editor > New query**, paste everything from `supabase/schema.sql`, press **Run**.
3. **Project Settings > API**: copy the **Project URL** and the **service_role** secret key.
4. **Vercel > your project > Settings > Environment Variables**, add (for Production, Preview and Development):
   - `SUPABASE_URL` = the Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = the service_role key
   - `APP_SECRET` = a long random value. Create one in Terminal with `openssl rand -hex 32`
5. **Vercel > Settings > General > Framework Preset**: `Other` (no build command, output directory empty).
6. Push to GitHub (`git push`), or press **Redeploy** in Vercel. Open your site and create an account.

Never put the service_role key or APP_SECRET in the code or share them; they belong only in Vercel's environment variables.
On the online version Ollama is hidden (it only works on your own computer), and speech-to-text works because the site uses https.

## Letting friends use it

- **Online:** share your Vercel address. Each friend creates an account and adds their own Gemini (free) or Claude key.
- **Same Wi-Fi / office network:** start the app and share the "On your Wi-Fi/LAN" address printed in Terminal (for example http://192.168.1.20:3020). Your Mac must stay on and awake.
- To keep the local app private to your Mac only, set `HOST=127.0.0.1` in `.env`.

## Settings file (.env)

| Setting | Meaning |
|---|---|
| APP_SECRET | Signs sign-in sessions and encrypts saved API keys. Created automatically on your Mac; set it yourself on Vercel |
| SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY | Optional on your Mac. When set, data is stored in Supabase instead of `data/` |
| GEMINI_API_KEY, ANTHROPIC_API_KEY, … | Old single-user keys. Imported once into the first account, then managed per user in AI settings |
| PORT | Default 3020. Change it if that port is busy |
| HOST | 0.0.0.0 = available on your network, 127.0.0.1 = this Mac only |

## Where things are stored

- On your Mac: accounts in `data/users.json` (passwords hashed, API keys encrypted), applications and reports in `data/history/`, recordings in `data/audio/`.
- Online: Supabase tables `users` and `applications`, recordings in the private `audio` storage bucket.
- `APP_SECRET` is in `.env` on your Mac. Never share this file. If it is lost, saved API keys must be entered again.

## Troubleshooting

| Message | Fix |
|---|---|
| Database not configured (online) | Add the Supabase variables in Vercel (see above) and redeploy |
| Database tables are missing | Run `supabase/schema.sql` in the Supabase SQL editor |
| Forgot password | Not available yet without an email service. On your Mac, delete the user from `data/users.json`; online, delete the row in Supabase > Table editor > users |
| Port 3020 is already in use | Add `PORT=3030` to `.env` and start again |
| Your API key was rejected | Create a new key (aistudio.google.com or console.anthropic.com) and save it in Settings |
| Gemini free-tier limit reached | Wait a minute, or until the next day for the daily limit |
| No credit left (Claude) | console.anthropic.com > Billing > add credit, or switch to Gemini |
| Ollama is not running | Open the Ollama app, then try again |
| Very little text was found | The PDF is a scanned image. Paste the resume text instead |
| Old .doc files are not supported | Open it in Word > Save As > .docx |
