const endpoint = process.env.CHROME_DEBUG_ENDPOINT || 'http://127.0.0.1:9222'

async function openTarget(url) {
  const response = await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  if (!response.ok) throw new Error(`Không thể tạo Chrome target: ${response.status}`)
  return response.json()
}

function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl)
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
  })
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  return {
    ready,
    async send(method, params = {}) {
      await ready
      const id = ++nextId
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    },
    close() { socket.close() },
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

async function waitForPage(client) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const ready = await evaluate(client, 'document.readyState')
    if (ready === 'complete') return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Trang không hoàn tất tải trong thời gian chờ')
}

const target = await openTarget('about:blank')
const client = connect(target.webSocketDebuggerUrl)
await client.ready
await client.send('Page.enable')
await client.send('Runtime.enable')

const viewports = [320, 375, 390, 430, 768, 1024, 1440]
const results = []

for (const width of viewports) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: width < 768 ? 844 : 900,
    deviceScaleFactor: 1,
    mobile: width < 768,
  })
  await client.send('Page.navigate', { url: 'http://127.0.0.1:5173/jobs' })
  await waitForPage(client)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const layout = await evaluate(client, `(() => ({
    path: location.pathname,
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflow: document.documentElement.scrollWidth > innerWidth,
    menuVisible: getComputedStyle(document.querySelector('.app-menu-toggle')).display !== 'none',
    filterVisible: getComputedStyle(document.querySelector('.public-filter-toggle')).display !== 'none'
  }))()`)

  let interactions = null
  if (width <= 430) {
    interactions = await evaluate(client, `(async () => {
      const wait = () => new Promise((resolve) => setTimeout(resolve, 100))
      const menu = document.querySelector('.app-menu-toggle')
      menu.click()
      await wait()
      const drawerOpened = menu.getAttribute('aria-expanded') === 'true' && Boolean(document.querySelector('.app-mobile-drawer'))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await wait()
      const drawerEscapeClosed = menu.getAttribute('aria-expanded') === 'false' && !document.querySelector('.app-mobile-drawer')
      menu.click()
      await wait()
      document.querySelector('.app-drawer-close')?.click()
      await wait()
      const drawerButtonClosed = menu.getAttribute('aria-expanded') === 'false' && !document.querySelector('.app-mobile-drawer')
      const filter = document.querySelector('.public-filter-toggle')
      filter.click()
      await wait()
      const form = document.querySelector('.public-filter-bar')
      const filterOpened = filter.getAttribute('aria-expanded') === 'true' && getComputedStyle(form).display !== 'none'
      document.querySelector('.public-filter-close')?.click()
      await wait()
      const filterClosed = filter.getAttribute('aria-expanded') === 'false'
      const chat = document.querySelector('.chat-toggle')
      chat.click()
      await wait()
      const loadedChat = document.querySelector('.chat-toggle')
      const chatOpened = loadedChat?.getAttribute('aria-expanded') === 'true' && Boolean(document.querySelector('.chat-panel'))
      document.querySelector('.chat-panel header button')?.click()
      await wait()
      const chatClosed = document.querySelector('.chat-toggle')?.getAttribute('aria-expanded') === 'false' && !document.querySelector('.chat-panel')
      return { drawerOpened, drawerEscapeClosed, drawerButtonClosed, filterOpened, filterClosed, chatOpened, chatClosed }
    })()`)
  }
  results.push({ route: '/jobs', width, ...layout, interactions })
}

await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await client.send('Page.navigate', { url: 'http://127.0.0.1:5173/login' })
await waitForPage(client)
results.push({ route: '/login', width: 390, ...(await evaluate(client, `(() => ({
  path: location.pathname,
  innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
  overflow: document.documentElement.scrollWidth > innerWidth
}))()`)) })

client.close()
console.log(JSON.stringify(results, null, 2))
