import { growdeskRouteBoundary } from "@/lib/growdesk/route-boundary";
import { bridgeErrorResponse } from "@/lib/growdesk/bridge-protocol";
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getLocalDateStr, getLocalDayUtcRange, formatIsoToLocalTime } from '@/lib/date'
import { requireAuth, requireBaby } from '@/lib/api-helpers'
import { safeJsonParse } from '@/lib/json'

export interface NotificationItem {
  id: string
  type: 'vaccine' | 'ai' | 'daily' | 'data_release' | 'family'
  title: string
  detail: string
  time: string
  urgent: boolean
  icon: string
  actorId?: string | null
  actorLabel?: string | null
  createdAt?: number
}

const RELATION_NAMES: Record<string, string> = {
  mother: '妈妈',
  father: '爸爸',
  grandparent: '长辈',
  caregiver: '月嫂/阿姨',
  parent: '家长',
  other: '家人',
}

const ENTITY_TYPE_NAMES: Record<string, string> = {
  feeding: '喂奶记录',
  sleep: '睡眠记录',
  diaper: '换尿布记录',
  food: '辅食记录',
  growth: '生长测量',
  supplement: '补剂打卡',
  medical_report: '体检化验单',
  vaccine: '疫苗记录',
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  return `${days}天前`
}

import { GROWDESK_CONFIG } from "@/lib/config"
import { resolveBffSession } from "@/lib/growdesk/session"
import { growdeskFetch } from "@/lib/growdesk/client"
import { fromGrowDeskNotification, bffNotificationStore } from "@/lib/growdesk/notifications"

export async function GET(request: Request) {
  return growdeskRouteBoundary(request, async () => {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request)
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 })
      }

      const remote = await bffNotificationStore.listNotifications(bffSession.user.id, { accessToken: bffSession.accessToken });
      const formatted: NotificationItem[] = remote.data.map(fromGrowDeskNotification)
      return NextResponse.json(formatted)
    }

    const auth = await requireAuth(request)
    if (auth.errorResponse) return auth.errorResponse
    const { user } = auth

    const { searchParams } = new URL(request.url)
    const requestedBabyId = searchParams.get('babyId')

    const babyResult = await requireBaby(user.id, requestedBabyId)
    if (babyResult.errorResponse) return babyResult.errorResponse
    const babyId = babyResult.baby.id
    const familyId = babyResult.baby.familyId

    const notifications: NotificationItem[] = []
    const todayStr = getLocalDateStr()
    const { start, end } = getLocalDayUtcRange(todayStr)
    const nowMs = Date.now()
    const since24h = new Date(nowMs - 24 * 60 * 60 * 1000)

    // 1. Vaccine reminders — upcoming within 7 days
    const vaccines = await prisma.vaccineRecord.findMany({
      where: { babyId, isCompleted: false },
      orderBy: { scheduledDate: 'asc' }
    })

    for (const v of vaccines) {
      const scheduledDate = new Date(v.scheduledDate)
      const diffMs = scheduledDate.getTime() - nowMs
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

      if (diffDays <= 7) {
        const isOverdue = diffDays < 0
        const timeLabel = isOverdue
          ? `已过期 ${Math.abs(diffDays)} 天`
          : diffDays === 0
            ? '今天'
            : `${diffDays} 天后`

        notifications.push({
          id: `vaccine-${v.id}`,
          type: 'vaccine',
          title: `💉 ${v.name} ${v.dose}`,
          detail: `计划接种日期：${v.scheduledDate}`,
          time: timeLabel,
          urgent: diffDays <= 3,
          icon: '💉',
          createdAt: nowMs,
        })
      }
    }

    // 2. Daily reminders — check today's records
    const [feedingRecords, sleepRecords, foodLogs] = await Promise.all([
      prisma.feedingRecord.findMany({
        where: { babyId, timestamp: { gte: start, lt: end } },
        take: 1
      }),
      prisma.sleepRecord.findMany({
        where: {
          babyId,
          startTime: { lt: end },
          endTime: { gt: start }
        },
        take: 1
      }),
      prisma.foodLogRecord.findMany({
        where: { babyId, date: todayStr },
        take: 1
      })
    ])

    const hasSleepToday = sleepRecords.length > 0

    if (feedingRecords.length === 0) {
      notifications.push({
        id: 'daily-feeding',
        type: 'daily',
        title: '🍼 记录喂奶',
        detail: '该记录今天的喂奶了',
        time: '今天',
        urgent: false,
        icon: '🍼',
        createdAt: nowMs,
      })
    }

    if (!hasSleepToday) {
      notifications.push({
        id: 'daily-sleep',
        type: 'daily',
        title: '😴 记录睡眠',
        detail: '该记录今天的睡眠了',
        time: '今天',
        urgent: false,
        icon: '😴',
        createdAt: nowMs,
      })
    }

    if (foodLogs.length === 0) {
      notifications.push({
        id: 'daily-food',
        type: 'daily',
        title: '🍚 记录辅食',
        detail: '该记录今天的辅食了',
        time: '今天',
        urgent: false,
        icon: '🍚',
        createdAt: nowMs,
      })
    }

    // 4. Family Member Activities (Submissions, Edits, Deletions in last 24h)
    const [
      recentFeedings,
      recentSleeps,
      recentDiapers,
      recentFoodLogs,
      recentGrowths,
      recentSupplements,
      recentSnapshots,
      familyMembers
    ] = await Promise.all([
      prisma.feedingRecord.findMany({
        where: { babyId, createdAt: { gte: since24h } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.sleepRecord.findMany({
        where: { babyId, createdAt: { gte: since24h } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.diaperRecord.findMany({
        where: { babyId, createdAt: { gte: since24h } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.foodLogRecord.findMany({
        where: { babyId, createdAt: { gte: since24h } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.growthMeasurement.findMany({
        where: { babyId, createdAt: { gte: since24h } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.supplementRecord.findMany({
        where: { babyId, createdAt: { gte: since24h } },
        include: { product: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.recordSnapshot.findMany({
        where: { babyId, createdAt: { gte: since24h } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.familyMember.findMany({
        where: { familyId },
        include: { user: { select: { displayName: true, username: true } } },
      }),
    ])

    const getMemberLabel = (uid?: string | null) => {
      if (!uid) return '家人'
      const m = familyMembers.find((mem) => mem.userId === uid)
      if (!m) return '家人'
      const rel = RELATION_NAMES[m.relation] || '家人'
      const name = m.user?.displayName || m.user?.username
      return name ? `${rel} (${name})` : rel
    }

    const familyNotifs: NotificationItem[] = []

    // Feedings
    for (const f of recentFeedings) {
      const actorLabel = getMemberLabel(f.recordedById)
      const feedTypeDesc =
        f.type === 'breast'
          ? `母乳 亲喂(左${f.leftMinutes || 0}分/右${f.rightMinutes || 0}分)`
          : f.type === 'bottle_breast'
            ? `瓶喂母乳 ${f.amountMl || 0}ml`
            : `配方奶 ${f.amountMl || 0}ml`
      familyNotifs.push({
        id: `family-feeding-${f.id}`,
        type: 'family',
        title: `🍼 ${actorLabel} 记录了喂奶`,
        detail: `${feedTypeDesc}${f.notes ? ` · 备注: ${f.notes}` : ''}`,
        time: formatRelativeTime(f.createdAt),
        urgent: false,
        icon: '🍼',
        actorId: f.recordedById,
        actorLabel,
        createdAt: f.createdAt.getTime(),
      })
    }

    // Sleeps
    for (const s of recentSleeps) {
      const actorLabel = getMemberLabel(s.recordedById)
      const timeRange = `${formatIsoToLocalTime(s.startTime)} ~ ${formatIsoToLocalTime(s.endTime)}`
      familyNotifs.push({
        id: `family-sleep-${s.id}`,
        type: 'family',
        title: `😴 ${actorLabel} 记录了睡眠`,
        detail: `${s.type === 'night' ? '夜觉' : '小睡'} · ${timeRange}${s.notes ? ` · 备注: ${s.notes}` : ''}`,
        time: formatRelativeTime(s.createdAt),
        urgent: false,
        icon: '😴',
        actorId: s.recordedById,
        actorLabel,
        createdAt: s.createdAt.getTime(),
      })
    }

    // Diapers
    for (const d of recentDiapers) {
      const actorLabel = getMemberLabel(d.recordedById)
      const diaperType = d.type === 'pee' ? '嘘嘘' : d.type === 'poop' ? '便便' : '嘘嘘+便便'
      familyNotifs.push({
        id: `family-diaper-${d.id}`,
        type: 'family',
        title: `🧷 ${actorLabel} 记录了换尿布`,
        detail: `${diaperType}${d.poopColor ? ` (${d.poopColor})` : ''}${d.notes ? ` · 备注: ${d.notes}` : ''}`,
        time: formatRelativeTime(d.createdAt),
        urgent: false,
        icon: '🧷',
        actorId: d.recordedById,
        actorLabel,
        createdAt: d.createdAt.getTime(),
      })
    }

    // Foods
    for (const fl of recentFoodLogs) {
      const actorLabel = getMemberLabel(fl.recordedById)
      const parsedFoods = safeJsonParse(fl.foods)
      const foodNames = Array.isArray(parsedFoods) ? parsedFoods.join('、') : '辅食'
      familyNotifs.push({
        id: `family-food-${fl.id}`,
        type: 'family',
        title: `🍚 ${actorLabel} 记录了辅食`,
        detail: `${foodNames} · 份量: ${fl.portion || '正常'}${fl.abnormalNotes ? ` · 异常: ${fl.abnormalNotes}` : ''}`,
        time: formatRelativeTime(fl.createdAt),
        urgent: false,
        icon: '🍚',
        actorId: fl.recordedById,
        actorLabel,
        createdAt: fl.createdAt.getTime(),
      })
    }

    // Supplements
    for (const sr of recentSupplements) {
      const actorLabel = getMemberLabel(sr.recordedById)
      familyNotifs.push({
        id: `family-supp-${sr.id}`,
        type: 'family',
        title: `💊 ${actorLabel} 记录了补剂打卡`,
        detail: `${sr.product?.name || '营养补剂'} ${sr.dose}${sr.unitName || ''}${sr.notes ? ` · 备注: ${sr.notes}` : ''}`,
        time: formatRelativeTime(sr.createdAt),
        urgent: false,
        icon: '💊',
        actorId: sr.recordedById,
        actorLabel,
        createdAt: sr.createdAt.getTime(),
      })
    }

    // Growth
    for (const g of recentGrowths) {
      const actorLabel = getMemberLabel(g.recordedById)
      const metrics = [
        g.weightKg ? `体重 ${g.weightKg}kg` : '',
        g.heightCm ? `身高 ${g.heightCm}cm` : '',
        g.headCircumferenceCm ? `头围 ${g.headCircumferenceCm}cm` : '',
      ].filter(Boolean).join(' · ')
      familyNotifs.push({
        id: `family-growth-${g.id}`,
        type: 'family',
        title: `📏 ${actorLabel} 记录了生长数据`,
        detail: metrics || '新增体检生长测量',
        time: formatRelativeTime(g.createdAt),
        urgent: false,
        icon: '📏',
        actorId: g.recordedById,
        actorLabel,
        createdAt: g.createdAt.getTime(),
      })
    }

    // Snapshots (Edits and Deletions)
    for (const snap of recentSnapshots) {
      const actorLabel = getMemberLabel(snap.userId)
      const entityName = ENTITY_TYPE_NAMES[snap.entityType] || '记录'
      const isUpdate = snap.action === 'update'
      familyNotifs.push({
        id: `family-snap-${snap.id}`,
        type: 'family',
        title: `${isUpdate ? '✏️' : '🗑️'} ${actorLabel} ${isUpdate ? '修改了' : '删除了'}${entityName}`,
        detail: `${isUpdate ? '修正了宝宝的' : '撤销了宝宝的'}${entityName}`,
        time: formatRelativeTime(snap.createdAt),
        urgent: false,
        icon: isUpdate ? '✏️' : '🗑️',
        actorId: snap.userId,
        actorLabel,
        createdAt: snap.createdAt.getTime(),
      })
    }

    // Sort family notifications newest first and take top 20
    familyNotifs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    notifications.push(...familyNotifs.slice(0, 20))

    // 5. Data release version info
    const dataRelease = await prisma.dataRelease.findFirst({
      include: { sources: true },
      orderBy: { createdAt: 'desc' }
    })

    if (dataRelease) {
      const org = dataRelease.sources?.[0]?.organization || '权威机构标准'
      notifications.push({
        id: `data-release-${dataRelease.id}`,
        type: 'data_release',
        title: '📊 数据版本更新',
        detail: `数据依据：${org}${dataRelease.asOf ? ` · 数据核对日期：${dataRelease.asOf}` : ''}`,
        time: dataRelease.asOf || '',
        urgent: false,
        icon: '📊'
      })
    }

    return NextResponse.json(notifications)
  } catch (error) {
    if (GROWDESK_CONFIG.enabled) return bridgeErrorResponse(error);
    console.error('GET /api/notifications error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
      { status: 500 }
    )
  }
  });
}
