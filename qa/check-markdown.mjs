import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
// Include new publishable files, but never count ignored scratch files as link targets.
const publishable = new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root, encoding: 'utf8',
}).split('\0').filter(Boolean))
const markdown = [...publishable].filter((file) => file.endsWith('.md'))
const failures = []
const images = new Set()
let localLinks = 0
let imageLinks = 0

function headings(text) {
  const counts = new Map()
  return [...text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map(([, title]) => {
    const base = title.toLowerCase().replace(/[`*_~]/g, '')
      .replace(/[^\p{L}\p{N}_\-\s]/gu, '').trim().replace(/\s/g, '-')
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    return count ? `${base}-${count}` : base
  })
}

function check(file, target, image) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return
  const [rawPath, anchor] = target.split('#', 2)
  const destination = rawPath
    ? path.resolve(root, path.dirname(file), decodeURIComponent(rawPath.split('?')[0]))
    : path.resolve(root, file)
  const relative = path.relative(root, destination).split(path.sep).join('/')
  localLinks += 1
  if (!fs.existsSync(destination)) {
    failures.push(`${file}: missing ${target}`)
    return
  }
  const isDirectory = fs.statSync(destination).isDirectory()
  if (!publishable.has(relative) && !(isDirectory && [...publishable].some((item) => item.startsWith(`${relative}/`)))) {
    failures.push(`${file}: target not included in a clean clone: ${target}`)
  }
  if (image) {
    imageLinks += 1
    images.add(destination)
    if (isDirectory || !fs.statSync(destination).size) failures.push(`${file}: empty/invalid image ${target}`)
  }
  if (anchor && destination.endsWith('.md')) {
    if (!headings(fs.readFileSync(destination, 'utf8')).includes(decodeURIComponent(anchor))) {
      failures.push(`${file}: missing anchor ${target}`)
    }
  }
}

for (const file of markdown) {
  const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/```[\s\S]*?```/g, '')
  for (const match of text.matchAll(/(!?)\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^)]*["'])?\)/g)) {
    check(file, match[2].replace(/^<|>$/g, ''), match[1] === '!')
  }
  const definitions = new Map()
  for (const match of text.matchAll(/^\s*\[([^\]]+)\]:\s*(<[^>]+>|\S+)/gm)) {
    definitions.set(match[1].toLowerCase(), match[2].replace(/^<|>$/g, ''))
    check(file, match[2].replace(/^<|>$/g, ''), false)
  }
  for (const match of text.matchAll(/(!?)\[([^\]]+)\]\[([^\]]*)\]/g)) {
    const key = (match[3] || match[2]).toLowerCase()
    if (!definitions.has(key)) failures.push(`${file}: undefined reference ${key}`)
    else if (match[1] === '!') check(file, definitions.get(key), true)
  }
  for (const match of text.matchAll(/<(img|a)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/gi)) {
    check(file, match[2], match[1].toLowerCase() === 'img')
  }
}
assert.deepEqual(failures, [], failures.join('\n'))

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  for (const imagePath of images) {
    const extension = path.extname(imagePath).toLowerCase()
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[extension]
    assert(mime, `Unknown image format: ${imagePath}`)
    const buffer = fs.readFileSync(imagePath)
    const info = await page.evaluate(async (url) => {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 100
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0, 100, 100)
      const pixels = context.getImageData(0, 0, 100, 100).data
      const colors = new Set()
      for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`)
      return { width: image.naturalWidth, height: image.naturalHeight, colors: colors.size }
    }, `data:${mime};base64,${buffer.toString('base64')}`)
    assert(info.width > 100 && info.height > 100 && info.colors > 20, `Blank/corrupt image: ${imagePath}`)
  }
} finally {
  await browser.close()
}
console.log(JSON.stringify({ markdownFiles: markdown.length, localLinks, imageLinks, decodedImages: images.size, failures }, null, 2))
