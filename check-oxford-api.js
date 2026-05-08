const word = 'thing';
const id = '69753c85';
const key = '285df1d44968b25a8e99df8ef7230edc';
(async () => {
  try {
    const res = await fetch(`https://od-api.oxforddictionaries.com/api/v2/entries/en-us/${encodeURIComponent(word)}`, {
      headers: { app_id: id, app_key: key },
    });
    console.log('status', res.status);
    console.log('ok', res.ok);
    const text = await res.text();
    console.log(text.slice(0, 2000));
  } catch (err) {
    console.error(err);
  }
})();
