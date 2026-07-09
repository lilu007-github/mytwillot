import { createSignal, onMount, Show } from 'solid-js'
import { A } from '@solidjs/router'

import {
  getAISettings,
  setAISettings,
  DEFAULT_MODELS,
  type AIProvider,
} from 'utils/ai/classify'

export default function Settings() {
  const [provider, setProvider] = createSignal<AIProvider>('anthropic')
  const [apiKey, setApiKey] = createSignal('')
  const [model, setModel] = createSignal(DEFAULT_MODELS.anthropic)
  const [saved, setSaved] = createSignal(false)

  onMount(async () => {
    const s = await getAISettings()
    setProvider(s.provider)
    setApiKey(s.apiKey)
    setModel(s.model)
  })

  const onProviderChange = (p: AIProvider) => {
    setProvider(p)
    // Reset the model to the provider default if it was the other default.
    if (
      model() === DEFAULT_MODELS.anthropic ||
      model() === DEFAULT_MODELS.openai ||
      !model()
    ) {
      setModel(DEFAULT_MODELS[p])
    }
  }

  const save = async (e: Event) => {
    e.preventDefault()
    await setAISettings({
      provider: provider(),
      apiKey: apiKey().trim(),
      model: model().trim() || DEFAULT_MODELS[provider()],
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div class="mx-auto my-6 w-full max-w-2xl px-4 text-gray-700 dark:text-white">
      <h1 class="mb-6 text-2xl font-semibold">Settings</h1>

      <section class="mb-8 rounded-lg border border-gray-200 p-5 dark:border-gray-700">
        <h2 class="mb-1 text-lg font-medium">AI Auto-Organize</h2>
        <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Use your own LLM API key to auto-sort bookmarks into folders. Your key
          is stored locally in the extension and sent directly to your chosen
          provider — never to Twillot's servers.
        </p>

        <form onSubmit={save} class="space-y-4">
          <div>
            <label class="mb-1 block text-sm font-medium">Provider</label>
            <select
              class="w-full rounded-lg border border-gray-300 bg-gray-50 p-2 text-sm dark:border-gray-600 dark:bg-gray-700"
              value={provider()}
              onChange={(e) =>
                onProviderChange(e.currentTarget.value as AIProvider)
              }
            >
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium">API Key</label>
            <input
              type="password"
              autocomplete="off"
              class="w-full rounded-lg border border-gray-300 bg-gray-50 p-2 text-sm dark:border-gray-600 dark:bg-gray-700"
              placeholder={
                provider() === 'anthropic' ? 'sk-ant-...' : 'sk-...'
              }
              value={apiKey()}
              onInput={(e) => setApiKey(e.currentTarget.value)}
            />
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium">Model</label>
            <input
              type="text"
              class="w-full rounded-lg border border-gray-300 bg-gray-50 p-2 text-sm dark:border-gray-600 dark:bg-gray-700"
              value={model()}
              onInput={(e) => setModel(e.currentTarget.value)}
            />
            <p class="mt-1 text-xs text-gray-400">
              Default: {DEFAULT_MODELS[provider()]}
            </p>
          </div>

          <div class="flex items-center gap-3">
            <button
              type="submit"
              class="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600"
            >
              Save
            </button>
            <Show when={saved()}>
              <span class="text-sm text-green-500">Saved ✓</span>
            </Show>
          </div>
        </form>
      </section>

      <section class="rounded-lg border border-gray-200 p-5 dark:border-gray-700">
        <h2 class="mb-1 text-lg font-medium">License</h2>
        <p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
          Manage your Twillot membership and unlock unlimited export.
        </p>
        <A
          href="/license"
          class="inline-block rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
        >
          Open License
        </A>
      </section>
    </div>
  )
}
