const test = async () => {
  const res = await fetch('http://localhost:3001/api/channels/7b09d0e9-25c1-46c1-8d14-99aa8dda8da5/logs');
  const text = await res.text();
  console.log(text);
};
test();
