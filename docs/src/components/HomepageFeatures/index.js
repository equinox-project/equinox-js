import React from "react"
import clsx from "clsx"
import styles from "./styles.module.css"

const FeatureList = [
  {
    title: "Small, sharp primitives",
    description: (
      <>
        EquinoxJS centers the model around deciders, folds, services and reactions. You get the core
        building blocks for event sourced systems without having to adopt a surrounding framework or
        command bus architecture.
      </>
    ),
  },
  {
    title: "Real deployment coverage",
    description: (
      <>PostgreSQL via MessageDB for relational deployments and DynamoStore for serverless ones.</>
    ),
  },
  {
    title: "Store-aware performance",
    description: (
      <>
        Performance characteristics stay visible at the category boundary. EquinoxJS lets you tune
        loading and caching behavior explicitly instead of flattening everything into a
        lowest-common-denominator generic store abstraction.
      </>
    ),
  },
  {
    title: "Operationally honest",
    description: (
      <>
        Ordering, idempotency, checkpointing and read lag stay explicit in the model. That makes
        production tradeoffs visible early and keeps the concrete things you inspect when debugging
        close at hand instead of buried in framework internals.
      </>
    ),
  },
  {
    title: "Not a framework",
    description: (
      <>
        You can expose a service API, a command handler API, or both. EquinoxJS has opinions about
        boundaries, not about your transport or application architecture.
      </>
    ),
  },
  {
    title: "First-class reactions",
    description: (
      <>
        Reactions and projection helpers cover the common read-model and process-manager patterns
        without locking you into one shape, so the same model can handle both the trivial cases and
        the awkward parts of a real domain.
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
