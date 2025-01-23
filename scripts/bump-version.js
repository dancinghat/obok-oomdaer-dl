const { readFileSync, writeFileSync } = require('fs')
const { resolve } = require('path')

const root = resolve(__dirname, '..')

const pkgPath = resolve(root, 'package.json')
const mfPath  = resolve(root, 'public/manifest.json')

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const mf  = JSON.parse(readFileSync(mfPath,  'utf8'))

const parts = pkg.version.split('.').map(Number)
parts[2]++
const next = parts.join('.')

pkg.version = next
mf.version  = next

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
writeFileSync(mfPath,  JSON.stringify(mf,  null, 2) + '\n')

console.log(`version → ${next}`)
