import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

type SchoolEntry = {
  teamName: string;
  prefectureKey: string;
  prefectureName: string;
};

type GameEntry = {
  id: string; // 試合ID
  name: string; // 試合名（例: 1回戦）
  month: string; // 月（例: 7）
  date: string; // 日（例: 15）
  start: string; // 開始時間（例: 10:00）
  stadiumName: string; // 球場
  topTeam: string;
  bottomTeam: string;
  topScore: string;
  bottomScore: string;
  topScores: string[];
  bottomScores: string[];
};

const GAS_API_URL = process.env.GAS_API_URL!;
const GAS_API_KEY = process.env.GAS_API_KEY!;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL!;

async function fetchHighSchools(): Promise<SchoolEntry[]> {
  try {
    const res = await axios.get(GAS_API_URL, {
      params: { key: GAS_API_KEY },
    });
    return res.data;
  } catch (err) {
    console.error('Google Spreadsheet へのアクセスに失敗しました');
    return [];
  }
}

async function getGamesByPref({prefectureKey, schools}: {prefectureKey: string; schools: SchoolEntry[]}): Promise<GameEntry[]> {
  const url = `https://www.asahicom.jp/koshien/contents/virtualbaseball/site/chihou_gamelist/${prefectureKey}.json`;
  try {
    const res = await axios.get(url);
    
    // レスポンスがJSONP形式の場合は、コールバック関数部分を削除
    let data = res.data;
    if (typeof data === 'string') {
      // JSONPの場合: koya_vk_chihou_gamelist({...}); の形式
      if (data.startsWith('koya_vk_chihou_gamelist(')) {
        // 先頭の関数名と括弧を削除し、末尾の `});` を削除
        data = data.slice('koya_vk_chihou_gamelist('.length, -2);
      }
      data = JSON.parse(data);
    }

    const gameList = data.result?.info?.game_list;
    if (!Array.isArray(gameList)) return [];

    const targetTeamNames = schools.map(school => school.teamName);
    const filteredGames = gameList.filter((g: any) => {
      const topTeam = g.top_school_display_name || g.school_display_name1 || g.team1 || '';
      const bottomTeam = g.bottom_school_display_name || g.school_display_name2 || g.team2 || '';
      return targetTeamNames.some(teamName => 
        [topTeam, bottomTeam].some((team) =>
          team === teamName
        )
      );
    });

    // フィルタリングされた試合のみをGameEntryに変換
    return filteredGames.map((g: any): GameEntry => ({
      id: g.game_id || '',
      name: g.round_name  || '',
      month: g.game_date_m || '',
      date: g.game_date_d || '',
      start: g.game_time || '',
      stadiumName: g.stadium_name || '',
      topTeam: g.top_school_display_name || '',
      bottomTeam: g.bottom_school_display_name || '',
      topScore: g.top_score_sum || '',
      bottomScore: g.bottom_score_sum || '',
      topScores: g.top_score || [],
      bottomScores: g.bottom_score || [],
    }));
  } catch (err) {
    console.warn('試合データ取得に失敗しました');
    return [];
  }
}

function formatGameMessage(game: GameEntry, targetTeamNames: string[]): string {
  // 各チームが対象校かどうかを判定
  const isTopTeamTarget = targetTeamNames.some(name => game.topTeam === name);
  const isBottomTeamTarget = targetTeamNames.some(name => game.bottomTeam === name);
  
  // 文字数を合わせるために全角スペースを追加
  const maxLength = Math.max(game.topTeam.length, game.bottomTeam.length);
  const topPadding = '　'.repeat(maxLength - game.topTeam.length);
  const bottomPadding = '　'.repeat(maxLength - game.bottomTeam.length);
  
  // 対象校の場合のみ太字にする（スペースは太字マークの外に配置）
  const topTeamDisplay = isTopTeamTarget ? `*${game.topTeam}*${topPadding}` : `${game.topTeam}${topPadding}`;
  const bottomTeamDisplay = isBottomTeamTarget ? `*${game.bottomTeam}*${bottomPadding}` : `${game.bottomTeam}${bottomPadding}`;
  
  return `
【${game.month}月${game.date}日 ${game.start}】 ${game.name} ＠${game.stadiumName}
${topTeamDisplay} : ${game.topScores.join(' | ')} || ${game.topScore}
${bottomTeamDisplay} : ${game.bottomScores.join(' | ')} || ${game.bottomScore}
  `.trim();
}

async function main() {
  const schools = await fetchHighSchools();
  if (schools.length === 0) {
    console.error('学校一覧が取得できませんでした。Google Spreadsheetへのアクセスを確認してください。');
    return;
  }
  
  const today = new Date().toLocaleDateString('ja-JP');
  const messages: string[] = [];

  // prefectureKeyごとにschoolsをグループ化
  const schoolsByPrefecture = new Map<string, SchoolEntry[]>();
  for (const school of schools) {
    if (!schoolsByPrefecture.has(school.prefectureKey)) {
      schoolsByPrefecture.set(school.prefectureKey, []);
    }
    schoolsByPrefecture.get(school.prefectureKey)!.push(school);
  }

  // prefectureKeyごとに処理
  for (const [prefectureKey, prefectureSchools] of schoolsByPrefecture) {
    const prefectureName = prefectureSchools[0].prefectureName;
    const games = await getGamesByPref({prefectureKey, schools: prefectureSchools});

    if (games.length === 0) {
      continue;
    }
    messages.push(`<https://vk.sportsbull.jp/koshien/${prefectureKey}/|${prefectureName}の試合結果>`)

    // 各試合について1回だけメッセージを作成
    const processedGames = new Set<string>();
    for (const game of games) {
      if (!processedGames.has(game.id)) {
        processedGames.add(game.id);
        const targetTeamNames = prefectureSchools.map(s => s.teamName);
        const msg = formatGameMessage(game, targetTeamNames);
        messages.push(msg);
      }
    }
  }

  if (messages.length === 0) {
    console.log('本日の対象試合はありませんでした');
    return;
  }

  const header = `【高校野球速報】*${today}* の試合結果`;
  const body = [header, ...messages].join('\n\n');

  await axios.post(SLACK_WEBHOOK_URL, { text: body });
  console.log(`Slack に投稿しました`);
}

main().catch(() => {
  console.error('通知処理中にエラーが発生しました');
  process.exit(1);
});
