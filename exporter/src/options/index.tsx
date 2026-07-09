/* @refresh reload */
import { render } from 'solid-js/web'
import { createSignal, Show } from 'solid-js'

import '../assets/main.css'
import Options from './Options'
import UserGridPage from './UserGridPage'

type Tab = 'dashboard' | 'users'

function App() {
  const [activeTab, setActiveTab] = createSignal<Tab>('dashboard')

  return (
    <div>
      <nav class="border-b border-gray-200 bg-white">
        <div class="mx-auto flex w-full max-w-7xl items-center gap-1 px-4 pt-2">
          <button
            class={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab() === 'dashboard'
                ? 'border-b-2 border-blue-500 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('dashboard')}
          >
            Dashboard
          </button>
          <button
            class={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab() === 'users'
                ? 'border-b-2 border-blue-500 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('users')}
          >
            Users
          </button>
        </div>
      </nav>
      <Show when={activeTab() === 'dashboard'}>
        <Options />
      </Show>
      <Show when={activeTab() === 'users'}>
        <UserGridPage />
      </Show>
    </div>
  )
}

render(() => <App />, document.getElementById('app') ?? document.body)
