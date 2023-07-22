"use strict";(self.webpackChunkdocs=self.webpackChunkdocs||[]).push([[365],{7522:(e,t,n)=>{n.d(t,{Zo:()=>l,kt:()=>v});var r=n(9901);function o(e,t,n){return t in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function c(e,t){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(e);t&&(r=r.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),n.push.apply(n,r)}return n}function i(e){for(var t=1;t<arguments.length;t++){var n=null!=arguments[t]?arguments[t]:{};t%2?c(Object(n),!0).forEach((function(t){o(e,t,n[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):c(Object(n)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))}))}return e}function a(e,t){if(null==e)return{};var n,r,o=function(e,t){if(null==e)return{};var n,r,o={},c=Object.keys(e);for(r=0;r<c.length;r++)n=c[r],t.indexOf(n)>=0||(o[n]=e[n]);return o}(e,t);if(Object.getOwnPropertySymbols){var c=Object.getOwnPropertySymbols(e);for(r=0;r<c.length;r++)n=c[r],t.indexOf(n)>=0||Object.prototype.propertyIsEnumerable.call(e,n)&&(o[n]=e[n])}return o}var s=r.createContext({}),d=function(e){var t=r.useContext(s),n=t;return e&&(n="function"==typeof e?e(t):i(i({},t),e)),n},l=function(e){var t=d(e.components);return r.createElement(s.Provider,{value:t},e.children)},p="mdxType",u={inlineCode:"code",wrapper:function(e){var t=e.children;return r.createElement(r.Fragment,{},t)}},m=r.forwardRef((function(e,t){var n=e.components,o=e.mdxType,c=e.originalType,s=e.parentName,l=a(e,["components","mdxType","originalType","parentName"]),p=d(n),m=o,v=p["".concat(s,".").concat(m)]||p[m]||u[m]||c;return n?r.createElement(v,i(i({ref:t},l),{},{components:n})):r.createElement(v,i({ref:t},l))}));function v(e,t){var n=arguments,o=t&&t.mdxType;if("string"==typeof e||o){var c=n.length,i=new Array(c);i[0]=m;var a={};for(var s in t)hasOwnProperty.call(t,s)&&(a[s]=t[s]);a.originalType=e,a[p]="string"==typeof e?e:o,i[1]=a;for(var d=2;d<c;d++)i[d]=n[d];return r.createElement.apply(null,i)}return r.createElement.apply(null,n)}m.displayName="MDXCreateElement"},2577:(e,t,n)=>{n.r(t),n.d(t,{assets:()=>s,contentTitle:()=>i,default:()=>u,frontMatter:()=>c,metadata:()=>a,toc:()=>d});var r=n(7364),o=(n(9901),n(7522));const c={sidebar_position:3},i="Decider",a={unversionedId:"core-concepts/decider",id:"core-concepts/decider",title:"Decider",description:"The best treatment of the concept of a Decider is Jeremie Chassaing's",source:"@site/docs/core-concepts/decider.md",sourceDirName:"core-concepts",slug:"/core-concepts/decider",permalink:"/equinox-js/docs/core-concepts/decider",draft:!1,editUrl:"https://github.com/nordfjord/equinox-js/tree/main/apps/docs/docs/core-concepts/decider.md",tags:[],version:"current",sidebarPosition:3,frontMatter:{sidebar_position:3},sidebar:"tutorialSidebar",previous:{title:"Stream",permalink:"/equinox-js/docs/core-concepts/stream"},next:{title:"Codec",permalink:"/equinox-js/docs/core-concepts/codec"}},s={},d=[],l={toc:d},p="wrapper";function u(e){let{components:t,...n}=e;return(0,o.kt)(p,(0,r.Z)({},l,n,{components:t,mdxType:"MDXLayout"}),(0,o.kt)("h1",{id:"decider"},"Decider"),(0,o.kt)("p",null,"The best treatment of the concept of a Decider is Jeremie Chassaing's\n",(0,o.kt)("a",{parentName:"p",href:"https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider"},"post"),"\non the subject. In EquinoxJS the type ",(0,o.kt)("inlineCode",{parentName:"p"},"Decider")," exposes an API for making\nConsistent Decisions against a Store derived from Events on a Stream. As Jeremie\nexplained in his article, a Decider for a counter whose values must be between 0\nand 10 could look like this: "),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-ts"},"type Event = { type: 'Incremented' } | { type: 'Decremented' }\ntype Command = { type: 'Increment' } | { type: 'Decrement' }\ntype State = number\nlet initial: State = 0\nlet evolve = (state: State, event: Event): State => {\n  switch (event.type) {\n    case 'Incremented': return state + 1\n    case 'Decremented': return state + 1\n  }\n}\nlet decide = (command: Command, state: State): Event[] => {\n  switch (command.type) {\n    case 'Increment': \n      if (state < 10) return [{ type: 'Incremented'  }]\n      return []\n\n    case 'Decrement': \n      if (state > 0) return [{ type: 'Decremented'  }]\n      return []\n  }\n}\n")),(0,o.kt)("p",null,"You could use the decider pattern as-is with Equinox by wiring it up as so:"),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-ts"},"class Service {\n  constructor(\n    private readonly resolve: (id: string) => Decider<Event, State>\n  ) {}\n\n  increment(id: string) {\n    const decider = this.resolve(id)\n    const command: Command = { type: 'Increment' }\n    return decider.transact(state => decide(command, state))\n  }\n\n  decrement(id: string) {\n    const decider = this.resolve(id)\n    const command: Command = { type: 'Decrement' }\n    return decider.transact(state => decide(command, state))\n  }\n\n  // wire up to memory store category\n  static create(store: VolatileStore<string>) {\n    const fold = (state: State, events: Event[]) => events.reduce(evolve, state)\n    const category = MemoryStoreCategory.create(store, 'Counter', codec, fold, initial)\n    const resolve = (id: string) => Decider.resolve(category, id, null)\n    return new Service(resolve)\n  }\n}\n")),(0,o.kt)("p",null,"However, we've arrived at a slight modification to the decider pattern through\nour experience developing event sourced applications. The first part of the\ndecider is its aggregate projection (initial + evolve). We expect users to\nsupply a ",(0,o.kt)("inlineCode",{parentName:"p"},"fold")," instead of an ",(0,o.kt)("inlineCode",{parentName:"p"},"evolve")," function. The difference there is that\nthe fold function receives a list of events while an evolve function receives a\nsingle event. "),(0,o.kt)("p",null,"More importantly, we've come to reject the Command pattern. Instead of exposing\na union type of all possible commands we expose functions. This is due to the\nfact that a single Command DU implies a single return type for all commands.\nWe've found that being able to return results from transacting is useful. For\nthe counter these changes might look like this:"),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-ts"},"// ^ everything up to and including evolve.\nconst fold = (state: State, events: Event[]) => events.reduce(evolve, state)\n\nconst increment = (state: State) => {\n  if (state < 10) return [{ type: 'Incremented'  }]\n  return []\n}\n\nconst decrement = (state: State) => {\n  if (state > 0) return [{ type: 'Decremented'  }]\n  return []\n}\n\nclass Service {\n  constructor(\n    private readonly resolve: (id: string) => Decider<Event, State>\n  ) {}\n\n  increment(id: string) {\n    const decider = this.resolve(id)\n    return decider.transact(increment)\n  }\n\n  decrement(id: string) {\n    const decider = this.resolve(id)\n    return decider.transact(decrement)\n  }\n\n  // wire up to memory store category\n  static create(store: VolatileStore<string>) {\n    const category = MemoryStoreCategory.create(store, 'Counter', codec, fold, initial)\n    const resolve = (id: string) => Decider.resolve(category, id, null)\n    return new Service(resolve)\n  }\n}\n")),(0,o.kt)("p",null,"It should be noted that these modifications do not sacrifice the testability of\ndeciders."),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-ts"},"const given (events: Event[], decide: (state: State) => Event[]) =>\n  decide(fold(initial, events))\n\ntest('Increment', () => \n  expect(given([], increment)).toEqual([{ type: 'Incremented' }])\n\ntest('Cannot increment over 10', () => \n  expect(given(Array(10).fill({type: 'Incremented'}), increment)).toEqual([]))\n")))}u.isMDXComponent=!0}}]);