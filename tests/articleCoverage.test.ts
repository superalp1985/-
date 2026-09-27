import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import coverage from '../articles/知乎专栏/coverage.json'
import { alpha158Factors, alpha360Factors } from '../src/factors'

const root = path.resolve('articles/知乎专栏')
const catalog = [...alpha158Factors, ...alpha360Factors]

describe('factor column coverage', () => {
  it('maps every catalog variant to exactly one family article', () => {
    const used = new Set<string>()
    expect(coverage.articles).toHaveLength(44)
    expect(new Set(coverage.articles.map((article) => article.path)).size).toBe(44)
    for (const factor of catalog) {
      const family = factor.id.startsWith('qlib-alpha158-') ? 'alpha158' : 'alpha360'
      const matches = coverage.articles.filter((article) => {
        if (!article.catalogs.includes(family)) return false
        if (family === 'alpha158' && factor.name === article.key) return true
        const suffix = factor.name.slice(article.key.length)
        return factor.name.startsWith(article.key) && (family === 'alpha158'
          ? /^(5|10|20|30|60)$/.test(suffix)
          : /^(?:[0-9]|[1-5][0-9])$/.test(suffix))
      })
      expect(matches, factor.id).toHaveLength(1)
      used.add(matches[0].path)
    }
    expect(catalog).toHaveLength(518)
    expect(used.size).toBe(44)
  })

  it.each(coverage.articles)('$key has a hands-on article and two existing PNG figures', (article) => {
    const file = path.join(root, article.path)
    const text = fs.readFileSync(file, 'utf8')
    expect(text).toMatch(/^## (自己动手|一个值得试的变体|一个有用的形状检查|把一根 K 线拼回来|从描述走向自己的因子)/m)
    expect(text).toMatch(/^## (在因子工坊里怎么拆|在画布中拆开)/m)
    expect(text).not.toContain('_tmp')
    const images = [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
    expect(images).toHaveLength(2)
    for (const [, image] of images) {
      const buffer = fs.readFileSync(path.resolve(path.dirname(file), image))
      expect(buffer.subarray(0, 8).toString('hex'), image).toBe('89504e470d0a1a0a')
      expect(buffer.byteLength).toBeGreaterThan(1000)
    }
  })
})
