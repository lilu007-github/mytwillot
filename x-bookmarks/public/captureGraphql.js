;(function () {
  const CAPTURE_SOURCE = 'twillot:x-graphql-response'

  // GraphQL operations we passively capture from the X web app's own traffic.
  // This is how bookmarks beyond the 800 API cap, likes, and followers are
  // obtained without issuing our own (rate-limited) requests.
  const CAPTURED_OPERATIONS = new Set([
    'Bookmarks',
    'Likes',
    'UserTweets',
    'UserTweetsAndReplies',
    'UserMedia',
    'Followers',
    'Following',
    'BlueVerifiedFollowers',
  ])

  // Extract the operation name from `/i/api/graphql/{queryId}/{OperationName}`.
  function getOperation(url) {
    try {
      const href = new URL(url, window.location.origin).href
      const match = href.match(/\/i\/api\/graphql\/[^/]+\/([^/?]+)/)
      return match ? match[1] : null
    } catch (err) {
      return null
    }
  }

  function shouldCapture(url) {
    const op = getOperation(url)
    return op && CAPTURED_OPERATIONS.has(op) ? op : null
  }

  function postCapturedResponse(url, operation, json) {
    const href = new URL(url, window.location.origin).href
    window.__twillotCaptureStats = {
      ...(window.__twillotCaptureStats || {}),
      lastCapturedUrl: href,
      lastCapturedOp: operation,
      lastCapturedAt: Date.now(),
    }
    // Single channel, origin-scoped. The content-script side additionally
    // verifies event.source === window and event.origin before forwarding.
    window.postMessage(
      {
        source: CAPTURE_SOURCE,
        operation,
        url: href,
        json,
      },
      window.location.origin,
    )
  }

  window.__twillotCaptureStats = {
    installedAt: Date.now(),
    fetchWrapped: false,
    xhrWrapped: false,
  }
  document.documentElement.dataset.twillotCapturePage = 'loaded'

  const originalFetch = window.fetch.bind(window)
  window.fetch = async (...args) => {
    const response = await originalFetch(...args)
    const input = args[0]
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input && input.url

    if (response.ok && url) {
      const operation = shouldCapture(url)
      if (operation) {
        response
          .clone()
          .json()
          .then((json) => postCapturedResponse(url, operation, json))
          .catch(() => {})
      }
    }

    return response
  }
  window.__twillotCaptureStats.fetchWrapped = true

  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function (
    method,
    url,
    async,
    username,
    password,
  ) {
    this.__twillotUrl = url && url.toString()
    return originalOpen.call(
      this,
      method,
      url,
      async === undefined ? true : async,
      username,
      password,
    )
  }

  XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener('load', function () {
      const url = this.__twillotUrl || this.responseURL
      if (!url || this.status < 200 || this.status >= 300) {
        return
      }
      const operation = shouldCapture(url)
      if (!operation) {
        return
      }
      try {
        postCapturedResponse(url, operation, JSON.parse(this.responseText))
      } catch (err) {
        /* ignore non-JSON */
      }
    })

    return originalSend.call(this, body)
  }
  window.__twillotCaptureStats.xhrWrapped = true
})()
