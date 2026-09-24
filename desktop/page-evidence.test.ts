import { describe, expect, it } from 'vitest'
import type { Page } from '@playwright/test'
import { READ_RESEARCH_PAGE, READ_SOURCE_LINKS } from './page-evidence'

type ResearchPage = { title: string; url: string; text: string; unsupportedFrames: number; truncated?: boolean }
type SourceLink = { url: string; title: string; description: string }
type Evaluate = <T>(expression: string) => Promise<T>
const attribute = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/** These tests use real DOM/layout and isolated-world reads; no model calls. */
async function fixture(html: string, check: (evaluate: Evaluate, page: Page) => Promise<void>) {
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JEVRY_BROWSER_EXECUTABLE || undefined })
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 500 } })
    const page = await context.newPage()
    await page.setContent(html)
    const session = await page.context().newCDPSession(page)
    const { frameTree } = await session.send('Page.getFrameTree')
    const { executionContextId } = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'jevry-source-evidence-test' })
    const evaluate: Evaluate = async <T>(expression: string): Promise<T> => {
      const result = await session.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
      return result.result.value
    }
    await check(evaluate, page)
  } finally { await browser.close() }
}

describe.runIf(process.env.JEVRY_BROWSER_TEST === '1')('full-page research evidence in real Chromium', () => {
  it('reads below-fold text in a background tab without scrolling or requiring a visible viewport', async () => {
    await fixture(`<html><head><title>Long source</title></head><body><h1>Opening paragraph</h1>
      <p style="margin-top:2500px">Below-fold conclusion: the measured value is 42.</p></body></html>`, async (evaluate, page) => {
      const foreground = await page.context().newPage()
      await foreground.bringToFront()
      await page.setViewportSize({ width: 1, height: 1 })
      const result = await evaluate<ResearchPage>(READ_RESEARCH_PAGE)
      expect(result.title).toBe('Long source')
      expect(result.text).toContain('Opening paragraph')
      expect(result.text).toContain('Below-fold conclusion: the measured value is 42.')
      expect(await page.evaluate(() => scrollY)).toBe(0)
    })
  }, 15_000)

  it('excludes hidden content, executable text and editable form values', async () => {
    await fixture(`<html><body><article>Public source content</article>
      <p hidden>HIDDEN_SECRET</p><p style="display:none">DISPLAY_SECRET</p>
      <p style="visibility:hidden">VISIBILITY_SECRET</p><p style="opacity:0">OPACITY_SECRET</p>
      <div aria-hidden="true"><span>ARIA_SECRET</span></div><div inert><span>INERT_SECRET</span></div>
      <script type="application/json">{"key":"SCRIPT_SECRET"}</script><style>.STYLE_SECRET{display:block}</style>
      <noscript>NOSCRIPT_SECRET</noscript><template>TEMPLATE_SECRET</template>
      <form><input value="INPUT_SECRET"><input type="password" value="PASSWORD_SECRET">
      <textarea>TEXTAREA_SECRET</textarea><select><option>SELECT_SECRET</option></select></form>
      <div contenteditable="true"><span>EDITOR_SECRET</span></div>
      <div contenteditable="plaintext-only">PLAINTEXT_SECRET</div>
      </body></html>`, async evaluate => {
      const result = await evaluate<ResearchPage>(READ_RESEARCH_PAGE)
      expect(result.text).toContain('Public source content')
      expect(result.text).not.toContain('_SECRET')
    })
  }, 15_000)

  it('includes open-shadow and visible same-origin frame text, while skipping hidden and opaque frames', async () => {
    const nested = '<html><body><p>Nested frame finding</p></body></html>'
    const embedded = `<html><body><p>Embedded source finding</p><iframe srcdoc="${attribute(nested)}"></iframe></body></html>`
    await fixture(`<html><body><source-widget></source-widget><hidden-widget style="display:none"></hidden-widget>
      <iframe style="margin-top:1800px" srcdoc="${attribute(embedded)}"></iframe>
      <iframe style="display:none" srcdoc="${attribute('<p>HIDDEN_FRAME_SECRET</p>')}"></iframe>
      <iframe style="width:0;height:0;border:0" srcdoc="${attribute('<p>ZERO_FRAME_SECRET</p>')}"></iframe>
      <details><summary>Collapsed embed</summary><iframe srcdoc="${attribute('<p>CLOSED_FRAME_SECRET</p>')}"></iframe></details>
      <div aria-hidden="true"><iframe srcdoc="${attribute('<p>ARIA_FRAME_SECRET</p>')}"></iframe></div>
      <iframe sandbox srcdoc="${attribute('<p>OPAQUE_FRAME_SECRET</p>')}"></iframe>
      <script>document.querySelector('source-widget').attachShadow({mode:'open'}).innerHTML='Direct shadow text<p>Shadow source finding</p>';
      document.querySelector('hidden-widget').attachShadow({mode:'open'}).innerHTML='<p>HIDDEN_SHADOW_SECRET</p>';</script>
      </body></html>`, async evaluate => {
      const result = await evaluate<ResearchPage>(READ_RESEARCH_PAGE)
      expect(result.text).toContain('Direct shadow text')
      expect(result.text).toContain('Shadow source finding')
      expect(result.text).toContain('Embedded source finding')
      expect(result.text).toContain('Nested frame finding')
      expect(result.text).not.toContain('_SECRET')
      expect(result.unsupportedFrames).toBeGreaterThanOrEqual(1)
    })
  }, 15_000)

  it('bounds research text and keeps form/hidden text out of source descriptions', async () => {
    await fixture(`<html><body><article><a href="https://example.com/source">Public source</a>
      <a href="https://example.com/source">Duplicate source</a><p>Useful public description</p>
      <textarea>FORM_DESCRIPTION_SECRET</textarea><div aria-hidden="true">HIDDEN_DESCRIPTION_SECRET</div></article>
      <p>${'Long public content. '.repeat(2000)}</p></body></html>`, async evaluate => {
      const result = await evaluate<ResearchPage>(READ_RESEARCH_PAGE)
      expect(result.text).toHaveLength(30000)
      expect(result.truncated).toBe(true)
      const links = await evaluate<SourceLink[]>(READ_SOURCE_LINKS)
      expect(links).toHaveLength(1)
      expect(links[0].description).toContain('Useful public description')
      expect(links[0].description).not.toContain('_SECRET')
    })
  }, 15_000)

  it('distinguishes rendered slot content and open details from suppressed fallback or closed details', async () => {
    await fixture(`<html><body><slotted-source><span>Assigned visible content</span></slotted-source>
      <details><summary>Closed section heading</summary><p>CLOSED_DETAILS_SECRET</p></details>
      <details open><summary>Open section heading</summary><p>Open section finding</p></details>
      <div style="display:contents"><p>Display contents finding</p></div>
      <script>document.querySelector('slotted-source').attachShadow({mode:'open'}).innerHTML='<slot>UNUSED_FALLBACK_SECRET</slot>';</script>
      </body></html>`, async evaluate => {
      const result = await evaluate<ResearchPage>(READ_RESEARCH_PAGE)
      expect(result.text).toContain('Assigned visible content')
      expect(result.text).toContain('Closed section heading')
      expect(result.text).toContain('Open section finding')
      expect(result.text).toContain('Display contents finding')
      expect(result.text).not.toContain('_SECRET')
    })
  }, 15_000)

  it('extracts source URLs and titles, decodes Google redirects and excludes unsupported destinations', async () => {
    await fixture(`<html><head><base href="https://www.google.com/search?q=fixture"></head><body>
      <article><a href="https://docs.example/guide"><h3>Primary guide</h3></a><p>Documented explanation of the result.</p></article>
      <a href="/url?q=${encodeURIComponent('https://example.org/report?a=1&b=2')}">Query redirect result</a>
      <a href="/url?url=${encodeURIComponent('https://example.net/reference')}">URL redirect result</a>
      <a href="https://notgoogle.com/url?q=https%3A%2F%2Fexample.edu%2F">Other host remains unchanged</a>
      <a href="/relative-source">Relative source</a>
      <a href="javascript:void(0)">Script destination</a><a href="mailto:someone@example.com">Mail destination</a>
      <a href="/url?q=${encodeURIComponent('javascript:alert(1)')}">Unsafe redirect</a>
      <a href="/url?q=${encodeURIComponent('https://%broken-host')}">Malformed redirect</a>
      <a href="/url?q=${encodeURIComponent('https://user:password@example.com/private')}">Credential redirect</a>
      </body></html>`, async evaluate => {
      const links = await evaluate<SourceLink[]>(READ_SOURCE_LINKS)
      expect(links.find(link => link.title === 'Primary guide')).toMatchObject({ url: 'https://docs.example/guide', description: expect.stringContaining('Documented explanation') })
      expect(links.find(link => link.title === 'Query redirect result')?.url).toBe('https://example.org/report?a=1&b=2')
      expect(links.find(link => link.title === 'URL redirect result')?.url).toBe('https://example.net/reference')
      expect(links.find(link => link.title === 'Other host remains unchanged')?.url).toBe('https://notgoogle.com/url?q=https%3A%2F%2Fexample.edu%2F')
      expect(links.find(link => link.title === 'Relative source')?.url).toBe('https://www.google.com/relative-source')
      expect(links.map(link => link.title)).not.toContain('Script destination')
      expect(links.map(link => link.title)).not.toContain('Mail destination')
      expect(links.map(link => link.title)).not.toContain('Unsafe redirect')
      expect(links.map(link => link.title)).not.toContain('Malformed redirect')
      expect(links.map(link => link.title)).not.toContain('Credential redirect')
    })
  }, 15_000)

  it('finds below-fold, shadow and same-origin frame links while rejecting hidden links', async () => {
    const frame = '<html><body><a href="https://frame.example/source">Frame source</a></body></html>'
    await fixture(`<html><body><a href="https://visible.example/source" style="display:block;margin-top:1800px">Below-fold source</a>
      <div aria-hidden="true"><a href="https://hidden.example/aria">ARIA hidden source</a></div>
      <div inert><a href="https://hidden.example/inert">Inert source</a></div>
      <div style="display:none"><a href="https://hidden.example/css">CSS hidden source</a></div>
      <source-links></source-links><iframe srcdoc="${attribute(frame)}"></iframe>
      <iframe hidden srcdoc="${attribute('<a href="https://hidden.example/frame">Hidden frame source</a>')}"></iframe>
      <script>document.querySelector('source-links').attachShadow({mode:'open'}).innerHTML='<a href="https://shadow.example/source">Shadow source</a>';</script>
      </body></html>`, async evaluate => {
      const links = await evaluate<SourceLink[]>(READ_SOURCE_LINKS)
      expect(links.map(link => link.title).sort()).toEqual(['Below-fold source', 'Frame source', 'Shadow source'])
    })
  }, 15_000)
})
