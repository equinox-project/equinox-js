import React from "react"
import clsx from "clsx"
import styles from "./styles.module.css"

const FeatureList = [
  {
    title: "Store agnostic",
    description: (
      <>
        Equinox is a lightweight library that makes it easy to develop event-sourced applications processing against stream-based stores. Your domain
        code is written in a storage-agnostic way and later wired up against concrete stores.
      </>
    ),
  },
  {
    title: "Multiple access strategies",
    description: <>Equinox has multiple access strategies available, including snapshots and only reading the latest event.</>,
  },
  {
    title: "Transparent caching",
    description: <>Equinox supports caching aggregate state using an LRU cache in an optimized and transparent way</>,
  },
  {
    title: "Concurrency Control",
    description: <>Equinox automates optimistic concurrency controls using a retry-loop.</>,
  },
  {
    title: "Not a framework",
    description: (
      <>
        Equinox provides a set of low-dependency libraries that can be composed to create a flexible architecture that meets the needs of your
        evolving application.
      </>
    ),
  },
]

function Feature({ title, description }) {
  return (
    <div className={clsx("col col--4")}>
      <div className="text--center padding-horiz--md">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  )
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  )
}
