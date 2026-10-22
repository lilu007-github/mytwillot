import { Show } from 'solid-js'

import { findRecords } from 'utils/db/tweets'
import {
  getMediaItemsIncludeQuote,
  getTweetsContainsMedia,
} from 'utils/api/twitter-media'
import { exportData } from 'utils/exporter'
import { Host, Tweet } from 'utils/types'

import { IconClose } from '../components/Icons'
import {
  EXPORT_FORM_FIELDS,
  EXPORT_MEDIA_FIELDS,
  getExportFields,
  getMediaSavePath,
} from '../libs/export-fields'
import dataStore, { mutateStore } from './store'
import Spinner from '../components/Spinner'
import VaultSync from '../components/VaultSync'
import ObsidianRest from '../components/ObsidianRest'
import AgentMirror from '../components/AgentMirror'

const [store, setStore] = dataStore

/** Tweet text followed by the rest of its thread, when it has one. */
function unrolledText(tweet: Tweet) {
  return tweet.conversations?.length
    ? tweet.full_text +
        '\n' +
        tweet.conversations.map((c) => c?.full_text || '').join('\n')
    : tweet.full_text
}

const ExportPage = () => {
  const exportBookmarks = async (e) => {
    e.preventDefault()
    const form: HTMLFormElement = e.target
    const params: any = {}
    EXPORT_FORM_FIELDS.forEach((field) => {
      params[field.name] = form[field.name].value
    })

    const records = await findRecords('', '', '', '', Number.MAX_SAFE_INTEGER)
    if (records.length === 0) {
      alert('No bookmarks found.')
      return
    }
    const fullText = (i: Tweet) =>
      params.unroll === 'yes' ? unrolledText(i) : i.full_text

    if (params.file_format === 'csv' || params.file_format === 'xlsx') {
      const isCsv = params.file_format === 'csv'
      exportData(
        records.map((i) => ({
          ...i,
          is_thread: i.is_thread || i.conversations?.length > 0,
          url: `${Host}/${i.screen_name}/status/${i.tweet_id}`,
          full_text: fullText(i),
        })),
        isCsv ? 'CSV' : 'Excel',
        isCsv ? 'twillot-bookmarks.csv' : 'twillot-bookmarks.xlsx',
        getExportFields(params.metadata === 'yes'),
      )
    } else if (params.file_format === 'json') {
      exportData(records, 'JSON', 'twillot-bookmarks.json')
    } else if (params.file_format === 'obsidian') {
      // Raw records: the Obsidian exporter reads epoch created_at, tags,
      // folder and thread fields directly to build one note per tweet.
      exportData(records, 'Obsidian', 'twillot-obsidian-vault.zip')
    } else if (
      params.file_format === 'markdown' ||
      params.file_format === 'pdf'
    ) {
      const enriched = records.map((i) => ({
        ...i,
        url: `${Host}/${i.screen_name}/status/${i.tweet_id}`,
        created_at: new Date(i.created_at * 1000).toLocaleString(),
        media: i.media_items,
        full_text: fullText(i),
      }))
      exportData(
        enriched,
        params.file_format === 'markdown' ? 'Markdown' : 'PDF',
        'twillot-bookmarks.md',
      )
    }
  }
  const exportMedia = async (e) => {
    e.preventDefault()
    const form: HTMLFormElement = e.target
    const params: any = {}
    EXPORT_MEDIA_FIELDS.forEach((field) => {
      params[field.name] = form[field.name].value
    })
    params['custom_save_path'] = form['custom_save_path']?.value
    const records = await getTweetsContainsMedia(
      params.media_type,
      true,
      Number.MAX_SAFE_INTEGER,
    )
    const mediaList = []
    for (const record of records) {
      const list = getMediaItemsIncludeQuote(record, params.media_type)
      mediaList.push(...list)
    }

    if (params.action_type === 'csv') {
      exportData(
        mediaList,
        'CSV',
        `twillot-${params.media_type === 'all' ? 'media' : params.media_type}-files.csv`,
        {
          media_url: 'Media URL',
          tweet_id: 'Post ID',
          tweet_url: 'Post URL',
          user_id: 'User ID',
          username: 'Username',
          screen_name: 'Screen Name',
          folder: 'Folder',
          created_at: 'Created At',
        },
      )
    } else if (params.action_type === 'media') {
      if (params.save_mode === 'custom' && !params.custom_save_path) {
        alert('Please set a custom save path.')
        return
      }

      let isCanceled = false
      setStore({
        isDownloadingMedia: true,
        downloadMediaCount: mediaList.length,
        downloadedMediaCount: 0,
        downloadedIds: [],
      })

      for (const item of mediaList) {
        // 可能随时取消
        if (!store.isDownloadingMedia) {
          isCanceled = true
          break
        }

        try {
          const filename = getMediaSavePath(
            item,
            params.save_mode,
            params.custom_save_path,
          )
          const id = await chrome.downloads.download({
            url: item.media_url,
            filename,
          })
          mutateStore((state) => {
            state.downloadedMediaCount += 1
            state.downloadedIds.push(id)
          })
        } catch (error) {
          console.error(error, item)
          setStore({
            downloadedMediaCount: store.downloadedMediaCount + 1,
          })
        }
      }
      setStore({
        isDownloadingMedia: false,
        downloadMediaCount: 0,
        downloadedMediaCount: 0,
        downloadedIds: [],
      })
      alert(
        isCanceled
          ? 'Download canceled.'
          : 'Your media files have been downloaded completely.',
      )
    }
  }

  const cancelDownloadMeida = async () => {
    // 先取消之前未完成的下载任务
    for (let index = 0; index < store.downloadedIds.length; index++) {
      const element = store.downloadedIds[index]
      await chrome.downloads.cancel(element)
    }
    setStore({
      isDownloadingMedia: false,
      downloadMediaCount: 0,
      downloadedMediaCount: 0,
      downloadedIds: [],
    })
  }

  return (
    <div class="container mx-auto p-4 text-base">
      <div class="mb-4 rounded-md border border-gray-200 p-4 dark:border-gray-700">
        <div class="w-full border-b pb-4 pt-2 text-lg font-bold text-gray-900 outline-none dark:border-gray-600  dark:border-b-[#121212]  dark:bg-[#121212] dark:text-white">
          Export Bookmarks
        </div>

        <div class="relative overflow-x-auto p-4 sm:rounded-lg">
          <form class="mx-auto block max-w-3xl" onSubmit={exportBookmarks}>
            {EXPORT_FORM_FIELDS.map((field) => {
              return (
                <div class="mb-4 flex gap-8">
                  <label class="mb-2 block w-32 text-right font-medium text-gray-900 dark:text-white">
                    {field.label}:
                  </label>
                  <fieldset class="flex-1">
                    {field.data.map((row, index) => (
                      <div class="mb-4 flex items-center text-sm">
                        <input
                          id={`${field.name}_${index}`}
                          type="radio"
                          value={row.value}
                          name={field.name}
                          class="h-4 w-4 border-gray-300 focus:ring-2 focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-700 dark:focus:bg-blue-600 dark:focus:ring-blue-600"
                          checked={row.value === field.default}
                        />
                        <label
                          for={`${field.name}_${index}`}
                          class="ms-2 flex cursor-pointer items-center font-medium text-gray-900 dark:text-gray-300"
                        >
                          {row.label}
                        </label>
                      </div>
                    ))}
                  </fieldset>
                </div>
              )
            })}

            <div class="my-5">
              <button
                type="submit"
                class="mb-2 me-8 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
              >
                Download
              </button>
            </div>
          </form>
        </div>
      </div>

      <VaultSync />

      <ObsidianRest />

      <AgentMirror />

      <div class="mb-4 rounded-md border border-gray-200 p-4 dark:border-gray-700">
        <div class="w-full border-b pb-4 pt-2 text-lg font-bold text-gray-900 outline-none dark:border-gray-600  dark:border-b-[#121212]  dark:bg-[#121212] dark:text-white">
          Export Media Files from Bookmarks
        </div>

        <div class="relative overflow-x-auto p-4 sm:rounded-lg">
          <form class="mx-auto block max-w-3xl" onSubmit={exportMedia}>
            {EXPORT_MEDIA_FIELDS.map((field) => {
              return (
                <div class={`mb-4 flex gap-8`}>
                  <label class="mb-2 block w-32 text-right font-medium text-gray-900 dark:text-white">
                    {field.label}:
                  </label>
                  <fieldset class="flex-1">
                    {field.data.map((row, index) => (
                      <div class="mb-4 flex items-center text-sm">
                        <input
                          id={`${field.name}_${index}`}
                          type="radio"
                          value={row.value}
                          name={field.name}
                          class="h-4 w-4 border-gray-300 focus:ring-2 focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-700 dark:focus:bg-blue-600 dark:focus:ring-blue-600"
                          checked={row.value === field.default}
                        />
                        <label
                          for={`${field.name}_${index}`}
                          class="ms-2 flex min-w-80 cursor-pointer items-center font-medium text-gray-900 dark:text-gray-300"
                        >
                          {typeof row.label === 'string'
                            ? row.label
                            : row.label()}
                        </label>
                      </div>
                    ))}
                  </fieldset>
                </div>
              )
            })}

            <div class="my-5 flex">
              <Show
                when={store.isDownloadingMedia}
                fallback={
                  <button
                    type="submit"
                    class={`mb-2 me-8 flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800`}
                  >
                    Download
                  </button>
                }
              >
                <button
                  type="button"
                  title="Click to cancel downloading"
                  onClick={cancelDownloadMeida}
                  class={`mb-2 me-8 flex w-36 items-center justify-center gap-2 rounded-lg bg-red-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-red-800 focus:outline-none focus:ring-4 focus:ring-red-300 dark:bg-red-600 dark:hover:bg-red-700 dark:focus:ring-red-800`}
                >
                  <Spinner className="h-5 w-5 fill-white text-gray-400 dark:text-gray-400" />
                  <span class="text-xs">
                    {store.downloadedMediaCount}/{store.downloadMediaCount}
                  </span>

                  <IconClose className="h-5 w-5" />
                </button>
              </Show>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default ExportPage
