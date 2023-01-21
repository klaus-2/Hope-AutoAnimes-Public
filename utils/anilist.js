const { fetch } = require('undici');

// Fetch data from Anilist
function fetchX(query, variables){
  return fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({ query, variables })
  })
  .then(res => res.json())
  .catch(err => err);
};

module.exports = { fetchX };
