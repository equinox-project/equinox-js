"use strict";(self.webpackChunkdocs=self.webpackChunkdocs||[]).push([[87],{7522:(e,t,n)=>{n.d(t,{Zo:()=>u,kt:()=>m});var o=n(9901);function r(e,t,n){return t in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function a(e,t){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var o=Object.getOwnPropertySymbols(e);t&&(o=o.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),n.push.apply(n,o)}return n}function i(e){for(var t=1;t<arguments.length;t++){var n=null!=arguments[t]?arguments[t]:{};t%2?a(Object(n),!0).forEach((function(t){r(e,t,n[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):a(Object(n)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))}))}return e}function s(e,t){if(null==e)return{};var n,o,r=function(e,t){if(null==e)return{};var n,o,r={},a=Object.keys(e);for(o=0;o<a.length;o++)n=a[o],t.indexOf(n)>=0||(r[n]=e[n]);return r}(e,t);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);for(o=0;o<a.length;o++)n=a[o],t.indexOf(n)>=0||Object.prototype.propertyIsEnumerable.call(e,n)&&(r[n]=e[n])}return r}var c=o.createContext({}),l=function(e){var t=o.useContext(c),n=t;return e&&(n="function"==typeof e?e(t):i(i({},t),e)),n},u=function(e){var t=l(e.components);return o.createElement(c.Provider,{value:t},e.children)},p="mdxType",h={inlineCode:"code",wrapper:function(e){var t=e.children;return o.createElement(o.Fragment,{},t)}},d=o.forwardRef((function(e,t){var n=e.components,r=e.mdxType,a=e.originalType,c=e.parentName,u=s(e,["components","mdxType","originalType","parentName"]),p=l(n),d=r,m=p["".concat(c,".").concat(d)]||p[d]||h[d]||a;return n?o.createElement(m,i(i({ref:t},u),{},{components:n})):o.createElement(m,i({ref:t},u))}));function m(e,t){var n=arguments,r=t&&t.mdxType;if("string"==typeof e||r){var a=n.length,i=new Array(a);i[0]=d;var s={};for(var c in t)hasOwnProperty.call(t,c)&&(s[c]=t[c]);s.originalType=e,s[p]="string"==typeof e?e:r,i[1]=s;for(var l=2;l<a;l++)i[l]=n[l];return o.createElement.apply(null,i)}return o.createElement.apply(null,n)}d.displayName="MDXCreateElement"},7595:(e,t,n)=>{n.r(t),n.d(t,{assets:()=>c,contentTitle:()=>i,default:()=>h,frontMatter:()=>a,metadata:()=>s,toc:()=>l});var o=n(7364),r=(n(9901),n(7522));const a={},i="Considerations",s={unversionedId:"reactions/considerations",id:"reactions/considerations",title:"Considerations",description:"In the previous section we learned about reactions but we omitted some important",source:"@site/docs/reactions/considerations.md",sourceDirName:"reactions",slug:"/reactions/considerations",permalink:"/equinox-js/docs/reactions/considerations",draft:!1,editUrl:"https://github.com/nordfjord/equinox-js/tree/main/apps/docs/docs/reactions/considerations.md",tags:[],version:"current",frontMatter:{},sidebar:"tutorialSidebar",previous:{title:"Reactions",permalink:"/equinox-js/docs/reactions/"},next:{title:"MessageDB",permalink:"/equinox-js/docs/stores/message-db/"}},c={},l=[],u={toc:l},p="wrapper";function h(e){let{components:t,...n}=e;return(0,r.kt)(p,(0,o.Z)({},u,n,{components:t,mdxType:"MDXLayout"}),(0,r.kt)("h1",{id:"considerations"},"Considerations"),(0,r.kt)("p",null,"In the previous section we learned about reactions but we omitted some important\nconcepts."),(0,r.kt)("h1",{id:"order-of-events"},"Order of Events"),(0,r.kt)("p",null,"While the order of events within a stream is guaranteed, the order of events\nacross different streams is not. This is something you need to be aware of when\ndesigning your reactions."),(0,r.kt)("p",null,"In the rare case you absolutely need ordering across streams we recommend\ncreating a third stream whose purpose is to provide a repeatably read order.\nThis is an easily abstractable problem. Take a look at\n",(0,r.kt)("a",{parentName:"p",href:"https://github.com/ntl/aggregate-streams"},"ntl/aggregate-streams")," for\ninspiration."),(0,r.kt)("h1",{id:"idempotency"},"Idempotency"),(0,r.kt)("p",null,"An idempotent action is one which can be repeated multiple times without\nchanging the outcome. Once you become aware of the concept you'll see it in your\ndaily life all the time. Think of the last time you crossed the street. There's\nusually a crosswalk with a beg-button. If you press the beg-button once it'll\nlight up to let you know your turn will come. But then, no matter how many times\nyou furiously press the beg-button after that it'll stay in the same state. This\nis idempotence."),(0,r.kt)("p",null,"Equinox provides at-least-once delivery semantics (there is no such thing as\n",(0,r.kt)("a",{parentName:"p",href:"https://bravenewgeek.com/you-cannot-have-exactly-once-delivery/"},"exactly-once\ndelivery"),"). As\nsuch your handler can receive the same event multiple times. You should ensure\nthat your reaction is resilient to this, in other words you should ensure that\nyour reaction is idempotent."),(0,r.kt)("p",null,"In the previous section's example, the notifier service checks if the message\nrecipients have been notified before attempting to send notifications. This is\nto avoid sending duplicate notifications if the operation was previously\nsuccessful. Idempotent reactions makes it easier to manage state and ensure\nconsistent results."),(0,r.kt)("h1",{id:"checkpointing"},"Checkpointing"),(0,r.kt)("p",null,"The checkpointer is a crucial component that ensures the state of the event\nprocessing is preserved. It maintains checkpoints on a per category per group\nbasis, recording the progress of event processing. This enables the system to\nresume from where it left off in case of a restart or a failure."),(0,r.kt)("h1",{id:"polling-and-batches"},"Polling and Batches"),(0,r.kt)("p",null,"Under the hood the source polls for batches of events. Checkpointing happens on\na per-batch basis. A simplified version of the subscriber would look like this: "),(0,r.kt)("pre",null,(0,r.kt)("code",{parentName:"pre",className:"language-ts"},"async function start() {\n  let checkpoint = await checkpointer.load()\n  while (true) {\n    const batch = await getNextBatch(checkpoint)\n    for (const [stream, events] of groupByStream(batch.messages)) {\n      await handle(stream, events)\n    }\n    if (batch.checkpoint > checkpoint) await checkpointer.save(batch.checkpoint)\n    if (batch.isTail) await sleep(tailSleepIntervalMs)\n  }\n}\n")),(0,r.kt)("p",null,"This should give you a rough idea of how the thing works. On top of this\nsimplified version we add bounded concurrent handling, cancellation, and\ntracing."),(0,r.kt)("p",null,"The properties of the subscriber can be altered to fit your needs as well. The\ntail sleep interval controls how long to wait between polls when we're at the\nend of the store, use a lower value of you need to be closer to real time. The\ngeneral advice is to tune it to roughly the throughput of the category such that\nan empty batch is a rare occurrence. Max concurrent streams controls how many\nstreams you can have in flight at any given moment. As an example, if your\nreaction involves a database you might use the same value for the database pool\nsize and the maximum concurrency."),(0,r.kt)("h1",{id:"shutdown"},"Shutdown"),(0,r.kt)("p",null,"When running your application, it's good practise to listen for system signals\nlike ",(0,r.kt)("inlineCode",{parentName:"p"},"SIGINT")," and ",(0,r.kt)("inlineCode",{parentName:"p"},"SIGTERM")," to gracefully stop the processing. If your source\nfails, you should restart it to ensure that your reactions continue processing\nevents."))}h.isMDXComponent=!0}}]);