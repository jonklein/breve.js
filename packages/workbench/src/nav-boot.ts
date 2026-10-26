import { mountNav } from './site-nav'

// the workbench shows the Docs tab on request, so it counts as the Docs page then
const docs = new URLSearchParams(location.search).get('tab') === 'docs'
mountNav(document.getElementById('site-nav')!, docs ? 'docs' : 'sim')
