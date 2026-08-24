import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAiTips } from '@/lib/ai-tips'
import { getLocalDateStr, getLocalDayUtcRange } from '@/lib/date'
import { requireAuth, requireBaby } from '@/lib/api-helpers'

export interface NotificationItem {
  id: string
  type: 'vaccine' | 'ai' | 'daily' | 'data_release'
  title: string
  detail: string
  time: string
  urgent: boolean
  icon: string
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request)
    if (auth.errorResponse) return auth.errorResponse
    const { user } = auth

    const { searchParams } = new URL(request.url)
    const requestedBabyId = searchParams.get('babyId')

    const babyResult = await requireBaby(user.id, requestedBabyId)
    if (babyResult.errorResponse) return babyResult.errorResponse
    const babyId = babyResult.baby.id

    const notifications: NotificationItem[] = []
    const todayStr = getLocalDateStr()
    const { start, end } = getLocalDayUtcRange(todayStr)

    // 1. Vaccine reminders — upcoming within 7 days
    const vaccines = await prisma.vaccineRecord.findMany({
      where: { babyId, isCompleted: false },
      orderBy: { scheduledDate: 'asc' }
    })


    for (const v of vaccines) {
      const scheduledDate = new Date(v.scheduledDate)
      const diffMs = scheduledDate.getTime() - Date.now()
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
          icon: '💉'
        })
      }
    }

    // 2. AI Tips (if AI service is up and responsive)
    try {
      const aiTips = await getAiTips(babyId)
      for (let i = 0; i < aiTips.length; i++) {
        notifications.push({
          id: `ai-${todayStr}-${i}`,
          type: 'ai',
          title: '🤖 AI 育儿建议',
          detail: aiTips[i],
          time: '今天',
          urgent: false,
          icon: '🤖'
        })
      }
    } catch {
      // If AI tips failed or offline, skip without adding fake suggestions
    }

    // 3. Daily reminders — check today's records
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
        icon: '🍼'
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
        icon: '😴'
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
        icon: '🍚'
      })
    }

    // 4. Data release version info
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
    console.error('GET /api/notifications error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
      { status: 500 }
    )
  }
}
