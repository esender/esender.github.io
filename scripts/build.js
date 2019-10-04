#!/usr/bin/env node

let { extname, join, basename } = require('path')
let { promisify } = require('util')
let Bundler = require('parcel-bundler')
let mqpacker = require('css-mqpacker')
let posthtml = require('posthtml')
let postcss = require('postcss')
let fs = require('fs')

let readFile = promisify(fs.readFile)
let writeFile = promisify(fs.writeFile)
let copyFile = promisify(fs.copyFile)

const A = 'a'.charCodeAt(0)

function findAssets (bundle) {
  return Array.from(bundle.childBundles).reduce((all, i) => {
    return all.concat(findAssets(i))
  }, [bundle.name])
}

let bundler = new Bundler(join(__dirname, '..', 'src', 'index.pug'), { sourceMaps: false })

async function build() {
  let bundle = await bundler.bundle()

  let assets = findAssets(bundle)

  let cssFile = assets.find(i => extname(i) === '.css')
  let imagesFiles = assets.filter(i => extname(i) === '.png')

  let css = await readFile(cssFile).then(i => i.toString())

  let classes = { }
  let lastUsed = -1

  function cssPlugin (root) {
    root.walkRules(rule => {
      rule.selector = rule.selector.replace(/\.[\w_-]+/g, str => {
        let kls = str.substr(1)
        if (!classes[kls]) {
          lastUsed += 1
          if (lastUsed === 26) lastUsed -= 26 + 7 + 25
          classes[kls] = String.fromCharCode(A + lastUsed)
        }
        return '.' + classes[kls]
      })
    })
  }

  css = postcss([cssPlugin, mqpacker]).process(css, { from: cssFile }).css

  function htmlPlugin (tree) {
    tree.match({ attrs: { class: true } }, i => {
      return {
        tag: i.tag,
        content: i.content,
        attrs: {
          ...i.attrs,
          class: i.attrs.class.split(' ').map(kls => {
            if (!classes[kls]) {
              process.stderr.write(`Unused class .${ kls }\n`)
              process.exit(1)
            }
            return classes[kls]
          }).join(' ')
        }
      }
    })
  }

  await writeFile(join(__dirname, '..', basename(cssFile)), css)
  await Promise.all(assets.filter(i => extname(i) === '.png').map(async i => {
    await copyFile(i, join(__dirname, '..', basename(i)))
  }))
  await Promise.all(assets
    .filter(i => extname(i) === '.html')
    .map(async i => {
      let html = await readFile(i)
      console.log(join(__dirname, '..', 'index.html'))
      await writeFile(join(__dirname, '..', 'index.html'), posthtml()
        .use(htmlPlugin)
        .process(html, { sync: true })
        .html)
    })
  )
}

build().catch(e => {
  process.stderr.write(e.stack + '\n')
  process.exit(1)
}).then(() => process.exit(0))
