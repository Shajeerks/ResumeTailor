// JD Resume Tailor — runs the app on this computer (npm start). On Vercel, api/index.js is used instead.
const os = require('os');
const app = require('./lib/app');

if (require.main === module && !process.env.VERCEL) {
  const PORT = Number(process.env.PORT) || 3020;
  const HOST = process.env.HOST || '0.0.0.0';
  const server = app.listen(PORT, HOST, () => {
    const lan = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    console.log('\n  JD Resume Tailor is running');
    console.log(`  On this computer:   http://localhost:${PORT}`);
    lan.forEach(ip => console.log(`  On your Wi-Fi/LAN:  http://${ip}:${PORT}`));
    console.log(`  Storage: ${app.storeKind === 'supabase' ? 'Supabase database' : 'files in ./data on this computer'}`);
    if (process.env.MOCK_AI === '1') console.log('  AI: forced demo mode (npm run demo)');
    console.log('  Press Ctrl+C to stop.\n');
  });
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is already in use. Edit PORT in the .env file (for example PORT=3030) and start again.\n`);
    else console.error(e);
    process.exit(1);
  });
  server.requestTimeout = 0; // generation can take a couple of minutes
}

module.exports = app;
