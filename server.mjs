import { red, green, cyan, bold } from 'colorette'
import loadConfigFile from 'rollup/dist/loadConfigFile'
import url from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import handler from 'serve-handler'
import * as rollup from 'rollup'
import metablock from 'rollup-plugin-userscript-metablock'

import pkg from "./package.json" assert { type: "json" }
import meta from "./meta.json" assert { type: "json" }

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

console.log('👀 watch & serve 🤲\n###################\n')

const port = pkg.config.port
const destDir = 'dist/'
const devScriptInFile = 'dev.user.js'

const hyperlink = (url, title) => `\u001B]8;;${url}\u0007${title || url}\u001B]8;;\u0007`

fs.mkdir('dist/', { recursive: true }, () => null)

// Start web server
const server = http.createServer((request, response) => {
  return handler(request, response, {
    public: destDir
  })
})
server.listen(port, () => {
  console.log(`Running webserver at ${hyperlink(`http://localhost:${port}`)}`)
})

// Create the userscript for development 'dist/dev.user.js'
const devScriptOutFile = path.join(destDir, devScriptInFile)
console.log(cyan(`generate development userscript ${bold('package.json')}, ${bold('meta.json')}, ${bold(devScriptInFile)} → ${bold(devScriptOutFile)}...`))
const devScriptContent = fs.readFileSync(devScriptInFile, 'utf8').replace(/%PORT%/gm, port.toString())
const grants = 'grant' in meta ? meta.grant : []
if (grants.indexOf('GM.xmlHttpRequest') === -1) {
  grants.push('GM.xmlHttpRequest')
}
if (grants.indexOf('GM.setValue') === -1) {
  grants.push('GM.setValue')
}
if (grants.indexOf('GM.getValue') === -1) {
  grants.push('GM.getValue')
}
// Just to suppress a type error.
const untypedMeta = {
  homepage: pkg.homepage,
  author: pkg.author,
  license: pkg.license,
}
const devMetablock = metablock({
  file: './meta.json',
  override: {
    name: pkg.name + ' [dev]',
    version: pkg.version,
    description: pkg.description,
    grant: grants,
    ...untypedMeta
  }
})

const result = devMetablock.renderChunk(devScriptContent, null, { sourcemap: false })
const outContent = typeof result === 'string' ? result : result.code
fs.writeFileSync(devScriptOutFile, outContent)
console.log(green(`created ${bold(devScriptOutFile)}. Please install in Tampermonkey: `) + hyperlink(`http://localhost:${port}/${devScriptInFile}`))

loadConfigFile(path.resolve(__dirname, 'rollup.config.mjs')).then(
  async ({ options, warnings }) => {
    // Start rollup watch
    const watcher = rollup.watch(options)

    watcher.on('event', event => {
      if (event.code === 'BUNDLE_START') {
        const input
          = event.input == null ? "(unknown)"
          : typeof event.input === "string" ? event.input
          : JSON.stringify(event.input)
        console.log(cyan(`bundles ${bold(input)} → ${bold(event.output.map(fullPath => path.relative(path.resolve(__dirname), fullPath)).join(', '))}...`))
      } else if (event.code === 'BUNDLE_END') {
        console.log(green(`created ${bold(event.output.map(fullPath => path.relative(path.resolve(__dirname), fullPath)).join(', '))} in ${event.duration}ms`))
      } else if (event.code === 'ERROR') {
        console.log(bold(red('⚠ Error')))
        console.log(event.error)
      }
      if ('result' in event && event.result) {
        event.result.close()
      }
    })

    // stop watching
    watcher.close()
  }
)
