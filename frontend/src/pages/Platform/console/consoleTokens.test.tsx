import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const source = readFileSync('src/pages/Platform/console/console-tokens.css', 'utf8')

// RGB channels from the console design system.
const tokenColors = {
  '--px-rail-faint': [141, 154, 179],
  '--px-bad-line': [239, 196, 194],
  '--px-plan-starter': [143, 176, 242],
  '--px-plan-pro': [79, 127, 230],
  '--px-plan-enterprise': [29, 63, 174],
  '--px-heat-0': [238, 241, 246],
  '--px-heat-1': [201, 216, 251],
  '--px-heat-2': [143, 176, 242],
  '--px-heat-3': [79, 127, 230],
  '--px-heat-4': [29, 63, 174],
  '--px-state-active': [37, 86, 216],
  '--px-state-past-due': [255, 210, 31],
  '--px-state-ending': [184, 110, 26],
  '--px-state-cancelled': [195, 204, 218],
  '--px-state-never': [232, 236, 243],
  '--px-ring-good': [31, 138, 82],
  '--px-callout': [17, 28, 54],
}

function styleRules(rules: CSSRuleList): CSSStyleRule[] {
  return Array.from(rules).flatMap((rule) => {
    if (rule instanceof CSSMediaRule) return styleRules(rule.cssRules)
    expect(rule).toBeInstanceOf(CSSStyleRule)
    return [rule as CSSStyleRule]
  })
}

describe('console stylesheet', () => {
  const style = document.createElement('style')
  let rules: CSSStyleRule[]

  beforeAll(() => {
    style.textContent = source
    document.head.append(style)
    if (!style.sheet) throw new Error('Console stylesheet did not load')
    rules = styleRules(style.sheet.cssRules)
  })

  afterAll(() => style.remove())

  it('declares exactly the documented console tokens at the console root', () => {
    const tokens: Array<[string, string]> = []
    for (const rule of rules) {
      for (const name of Array.from(rule.style).filter((property) => property.startsWith('--'))) {
        expect(rule.selectorText).toBe('.px-console')
        tokens.push([name, rule.style.getPropertyValue(name).trim()])
      }
    }

    const expected = Object.entries(tokenColors).map(([name, channels]) => [
      name,
      `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`,
    ])
    expect(tokens.sort()).toEqual(expected.sort())
  })

  it('scopes every selector, including rules inside media queries', () => {
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) {
      for (const selector of rule.selectorText.split(',')) {
        expect(selector.trim()).toMatch(/^\.px-console(?=$|[:\s])/)
        expect(selector).not.toMatch(/[+~]/)
      }
    }
  })
})
