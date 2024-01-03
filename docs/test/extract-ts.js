const glob = require("glob")
const fs = require("fs")
const path = require("path")
const mkdirp = require("mkdirp")
const rm = require("rimraf")
const files = glob.sync("./docs/**/*.md")

rm.sync("./test/docs")

for (const file of files) {
  const content = fs.readFileSync(file, "utf8").toString()
  console.log(file)

  const ts = content.match(/```ts([\s\S]*?)```/g)
  if (!ts) continue
  let tsContent = ""
  for (const t of ts) {
    tsContent = tsContent + "\n" + t.replace(/```ts/g, "").replace(/```/g, "")
  }
  const newFile = "./test/" + file.replace(".md", ".ts")
  mkdirp.sync(path.dirname(newFile))
  fs.writeFileSync(newFile, tsContent)
}
