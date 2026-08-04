import type { DevelopmentMilestone, ActivityRecommendation } from '../types';

export const mockMilestones: DevelopmentMilestone[] = [
  // Gross Motor
  { id: 'dm1', category: 'gross_motor', month: 6, title: '俯卧抬头', description: '趴着时能稳定抬头90度，自由转动头部观察周围', status: 'achieved' },
  { id: 'dm2', category: 'gross_motor', month: 6, title: '翻身', description: '能从仰卧翻到俯卧，部分宝宝开始双向翻身', status: 'practicing' },
  { id: 'dm3', category: 'gross_motor', month: 6, title: '支撑坐', description: '靠着支撑物可以短暂坐稳', status: 'practicing' },
  { id: 'dm4', category: 'gross_motor', month: 6, title: '地面自由活动', description: '在地板上自由踢腿、转动，锻炼核心力量', status: 'upcoming' },

  // Cognitive
  { id: 'dm5', category: 'cognitive', month: 6, title: '物体追踪', description: '眼睛可以跟随移动的物体180度', status: 'achieved' },
  { id: 'dm6', category: 'cognitive', month: 6, title: '因果关系', description: '开始理解按压会发声、摇动会有声音', status: 'practicing' },
  { id: 'dm7', category: 'cognitive', month: 6, title: '寻找物体', description: '当物体被部分遮挡时会尝试寻找', status: 'upcoming' },

  // Language
  { id: 'dm8', category: 'language', month: 6, title: '发出元音', description: '能发出"啊"、"哦"、"噢"等元音', status: 'achieved' },
  { id: 'dm9', category: 'language', month: 6, title: '声源定位', description: '听到声音会转头寻找声源', status: 'achieved' },
  { id: 'dm10', category: 'language', month: 6, title: '辅音萌芽', description: '开始出现"ba"、"ma"等音节', status: 'practicing' },

  // Fine Motor
  { id: 'dm11', category: 'fine_motor', month: 6, title: '抓握物品', description: '能主动伸手抓取面前的玩具', status: 'achieved' },
  { id: 'dm12', category: 'fine_motor', month: 6, title: '双手传递', description: '能将物品从一只手传到另一只手', status: 'practicing' },
  { id: 'dm13', category: 'fine_motor', month: 6, title: '耙弄小物', description: '能用手指耙弄桌上的小食物', status: 'upcoming' },
];

export const mockActivities: ActivityRecommendation[] = [
  {
    id: 'a1',
    title: '抓握与传递',
    tag: '蒙台梭利',
    materials: ['柔软球', '布球', '篮子'],
    steps: [
      '将物体放在宝宝面前',
      '引导宝宝自主抓握',
      '抓住后鼓励传递到另一只手',
      '成人减少干预，让宝宝自己探索',
    ],
  },
  {
    id: 'a2',
    title: '音乐律动',
    tag: '奥尔夫音乐',
    materials: ['沙锤', '铃铛', '小鼓'],
    steps: [
      '播放轻柔的音乐',
      '让宝宝躺在柔软的垫子上',
      '将小乐器放在宝宝手边',
      '鼓励宝宝拍打、摇晃发出声音',
    ],
  },
];

export const monthOptions = [4, 5, 6, 7, 8].map(m => `${m}月龄`);
