(function () {
  const CAPTURE_SOURCE = 'twillot:x-user-list-response'

  function isUserListUrl(url) {
    const href = new URL(url, window.location.origin).href
    return (
      href.includes('/i/api/graphql/') &&
      (href.includes('/Followers?') || href.includes('/Following?'))
    )
  }

  function postCapturedResponse(url, json) {
    const href = new URL(url, window.location.origin).href
    window.__twillotCaptureStats = {
      ...(window.__twillotCaptureStats || {}),
      lastCapturedUrl: href,
      lastCapturedAt: Date.now(),
    }
    console.info('Twillot captured X user list response', href)
    window.postMessage(
      {
        source: CAPTURE_SOURCE,
        url: href,
        json,
      },
      '*',
    )
    document.dispatchEvent(
      new CustomEvent(CAPTURE_SOURCE, {
        detail: {
          url: href,
          json,
        },
      }),
    )
  }

  window.__twillotCaptureStats = {
    installedAt: Date.now(),
    fetchWrapped: false,
    xhrWrapped: false,
  }
  document.documentElement.dataset.twillotCapturePage = 'loaded'
  console.info('Twillot follower capture loaded')

  const originalFetch = window.fetch.bind(window)
  window.fetch = async (...args) => {
    const response = await originalFetch(...args)
    const input = args[0]
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

    if (response.ok && isUserListUrl(url)) {
      response
        .clone()
        .json()
        .then((json) => postCapturedResponse(url, json))
        .catch((err) => {
          console.warn('Twillot failed to capture X user list response', err)
        })
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
    this.__twillotUrl = url.toString()
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
      if (
        !url ||
        this.status < 200 ||
        this.status >= 300 ||
        !isUserListUrl(url)
      ) {
        return
      }

      try {
        postCapturedResponse(url, JSON.parse(this.responseText))
      } catch (err) {
        console.warn('Twillot failed to capture X XHR user list response', err)
      }
    })

    return originalSend.call(this, body)
  }
  window.__twillotCaptureStats.xhrWrapped = true
})()
