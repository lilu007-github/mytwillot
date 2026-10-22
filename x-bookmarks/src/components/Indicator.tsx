import Spinner from './Spinner'

export default function Indicator(props: { text: any }) {
  return (
    <div class="my-4 flex w-full flex-col items-center justify-center">
      <Spinner />
      <p class="mt-4 text-balance text-lg text-blue-500">{props.text}</p>
    </div>
  )
}
