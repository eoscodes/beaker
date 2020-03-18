import './intro.js'
import './migrating.js'
import './profile.js'

function isStageDone (key) {
  var url = new URL(location.toString())
  return Boolean(+url.searchParams.get(key))
}

customElements.define('setup-app', class extends HTMLElement {
  constructor () {
    super()
    this.stages = []

    if (!isStageDone('profileSetup')) {
      this.stages.push('profile-view')
    }
    if (!isStageDone('migrated08to09')) {
      this.stages.push('migrating-view')
    }
    if (this.stages.length === 2) {
      this.stages.unshift('intro-view')
      document.body.style.background = '#334'
      document.body.style.transition = 'background 0.5s'
    }

    this.stage = 0
    this.render()
    this.addEventListener('next', this.onNext.bind(this))
  }

  render () {
    if (!this.stages[this.stage]) return
    this.innerHTML = `<${this.stages[this.stage]} current></${this.stages[this.stage]}>`
  }

  async onNext () {
    document.body.style.background = '#fff' // switch away from dark bg after first stage
    this.stage++
    this.render()
  }
})