// Builds GradeStudio as a Windows program, installs it for the current user
// (%LOCALAPPDATA%\Programs\GradeStudio) and puts shortcuts on the desktop and
// in the start menu. Run: npm run desktop
import { packager } from '@electron/packager'
import electron from 'electron'
import { execFileSync } from 'node:child_process'
import { cp, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

if (process.platform !== 'win32') {
  console.error('npm run desktop builds and installs the Windows app. On other systems use "npm run app".')
  process.exit(1)
}

const root = path.join(import.meta.dirname, '..')
const release = path.join(root, 'release')
const target = path.join(process.env.LOCALAPPDATA, 'Programs', 'GradeStudio')
const exe = path.join(target, 'GradeStudio.exe')

execFileSync(electron, [path.join(root, 'electron', 'icon.js')], { stdio: 'inherit' })

const [built] = await packager({
  dir: root,
  out: release,
  name: 'GradeStudio',
  executableName: 'GradeStudio',
  platform: 'win32',
  arch: 'x64',
  overwrite: true,
  asar: true,
  prune: false,
  icon: path.join(release, 'icon.ico'),
  win32metadata: { ProductName: 'GradeStudio', FileDescription: 'GradeStudio', CompanyName: 'GradeStudio' },
  // Only the built app and the shell go into the program.
  ignore: (file) => file !== '' && !/^\/(dist(\/|$)|electron(\/main\.js)?$|package\.json$)/.test(file),
})

// Chromium ships 55 UI languages; English is enough for this app.
const locales = path.join(built, 'locales')
for (const f of await readdir(locales)) if (f !== 'en-US.pak') await rm(path.join(locales, f))

// Replace an earlier install, but never a folder that is not ours.
const existing = await readdir(target).catch(() => null)
if (existing && !existing.includes('GradeStudio.exe')) throw new Error(`${target} does not belong to GradeStudio.`)
try {
  await rm(target, { recursive: true, force: true })
} catch {
  console.error('\nGradeStudio is still running. Close it and run "npm run desktop" again.')
  process.exit(1)
}
await cp(built, target, { recursive: true })
await rm(built, { recursive: true, force: true }).catch(() => {})

const q = (s) => `'${s.replaceAll("'", "''")}'`
const shortcut = (folder) => `
  $p = Join-Path ([Environment]::GetFolderPath('${folder}')) 'GradeStudio.lnk'
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($p)
  $s.TargetPath = ${q(exe)}
  $s.WorkingDirectory = ${q(target)}
  $s.IconLocation = ${q(exe + ',0')}
  $s.Description = 'GradeStudio - photo editor'
  $s.Save()
  $p`
const links = execFileSync('powershell', ['-NoProfile', '-Command', shortcut('Desktop') + shortcut('Programs')], { encoding: 'utf8' })

console.log(`\nGradeStudio installed: ${exe}`)
console.log(`Shortcuts:\n${links.trim()}`)
