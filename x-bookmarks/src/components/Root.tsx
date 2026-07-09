/* @refresh reload */
import { HashRouter, Route } from '@solidjs/router'

import { Home } from '../options/Home'
import License from '../options/License'
import Export from '../options/Export'
import CategoryView from '../options/CategoryView'
import UserGridPage from '../options/grid/UserGridPage'
import AccountManagement from '../components/AccountManagement'
import Layout from '../options/Layout'
import '../assets/main.css'

export default function getRoot() {
  return (
    <HashRouter root={Layout}>
      <Route path="/" component={Home} />
      <Route path="/type/:type" component={CategoryView} />
      <Route path="/users" component={UserGridPage} />
      <Route path="/accounts" component={AccountManagement} />
      <Route path="/license" component={License} />
      <Route path="/export" component={Export} />
    </HashRouter>
  )
}
