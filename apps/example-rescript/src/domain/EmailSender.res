module Memory = {
  let sendEmail = async (to, title, body) => {
    Js.logMany(["To: ", to, "Title: ", title, "Body: ", body])
  }
}
