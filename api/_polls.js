// 투표 한 개 찾기: 기본 투표(main) + 자동 수집 투표(feed)
const FEED = 'https://raw.githubusercontent.com/handgoldking1234/neaniyo/feed/data/polls.json';

export async function findPoll(id, origin) {
  if (!id || !/^[\w-]{1,40}$/.test(id)) return null;
  const urls = [origin + '/data/polls.json', FEED];
  const lists = await Promise.all(urls.map(u =>
    fetch(u).then(r => (r.ok ? r.json() : [])).catch(() => [])
  ));
  for (const list of lists) {
    const arr = Array.isArray(list) ? list : (list && list.polls) || [];
    const p = arr.find(x => x && x.id === id);
    if (p) {
      // 공개 시각 전인 예약 투표는 미리 보여주지 않음
      if (p.at && Date.parse(p.at) > Date.now()) return null;
      return p;
    }
  }
  return null;
}
