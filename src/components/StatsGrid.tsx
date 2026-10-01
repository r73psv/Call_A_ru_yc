/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Phone, AlertTriangle, Star, CheckCircle, TrendingUp, TrendingDown,
  Clock, Flame, Activity, BarChart2, Grid3X3, Info, 
  Users, ChevronDown, ChevronUp, Zap, Sparkles,
  Smile, Frown, HeartHandshake, ShieldCheck, Calendar, LineChart as LineChartIcon,
  Award, FileDown, ArrowUpDown, ChevronRight, SlidersHorizontal, ArrowUpRight, 
  ArrowDownRight, Minus, RefreshCcw, FileText, Check, Loader2, ArrowRight
} from 'lucide-react';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, 
  Tooltip as RechartsTooltip, Cell, ReferenceLine, CartesianGrid,
  LineChart, Line, Legend
} from 'recharts';
import * as d3 from 'd3';
import { DashboardStats, CallRecord, SentimentTrendItem } from '../types.js';

export interface PeriodStatsReportData {
  periodTitle: string;
  periodDates: string;
  isComparative: boolean;
  comparePeriodTitle?: string;
  compareDates?: string;
  currentStats: {
    totalCalls: number;
    incomingCalls: number;
    outgoingCalls: number;
    completedCalls: number;
    missedCalls: number;
    bookedCount: number;
    declinedCount: number;
    consultationCount: number;
    conversionRate: number;
    averageScore: number;
    disputeCount: number;
    disputeRate: number;
    avgDurationSec: number;
  };
  previousStats?: {
    totalCalls: number;
    incomingCalls: number;
    outgoingCalls: number;
    completedCalls: number;
    missedCalls: number;
    bookedCount: number;
    declinedCount: number;
    consultationCount: number;
    conversionRate: number;
    averageScore: number;
    disputeCount: number;
    disputeRate: number;
    avgDurationSec: number;
  };
  operators: Array<{
    name: string;
    totalCalls: number;
    avgScore: number | null;
    bookedCount: number;
    conversionRate: number;
    disputes: number;
    prevAvgScore?: number | null;
    prevConversionRate?: number;
  }>;
  hourlyPeakHours?: string;
  userRole?: string;
}

interface StatsGridProps {
  stats: DashboardStats;
  calls?: CallRecord[];
  authToken?: string | null;
  userRole?: string;
}

const RUSSIAN_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const RUSSIAN_DAY_FULL_NAMES = [
  'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'
];

interface CellData {
  dayIndex: number;
  dayName: string;
  dayFullName: string;
  hour: number;
  hourLabel: string;
  totalCalls: number;
  bookedCalls: number;
  disputeCalls: number;
  avgScore: number | null;
}

export function StatsGrid({ stats, calls = [], authToken, userRole }: StatsGridProps) {
  // Period Selection and Comparative Analysis
  const { minDateStr, maxDateStr } = useMemo(() => {
    if (!calls || calls.length === 0) return { minDateStr: '2026-07-01', maxDateStr: '2026-10-01' };
    const sorted = [...calls]
      .map(c => c.timestamp?.slice(0, 10))
      .filter((d): d is string => !!d)
      .sort();
    if (sorted.length === 0) return { minDateStr: '2026-07-01', maxDateStr: '2026-10-01' };
    return { minDateStr: sorted[0], maxDateStr: sorted[sorted.length - 1] };
  }, [calls]);

  const [periodType, setPeriodType] = useState<'week' | 'month' | 'year' | 'custom' | 'all'>('all');
  const [startDate, setStartDate] = useState<string>(() => minDateStr);
  const [endDate, setEndDate] = useState<string>(() => maxDateStr);
  const [isComparative, setIsComparative] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Sync dates when min/max dates change initially if in 'all' mode
  React.useEffect(() => {
    if (periodType === 'all') {
      setStartDate(minDateStr);
      setEndDate(maxDateStr);
    }
  }, [minDateStr, maxDateStr, periodType]);

  const handleSelectPreset = (type: 'week' | 'month' | 'year' | 'custom' | 'all') => {
    setPeriodType(type);
    const endD = new Date(maxDateStr);
    if (type === 'week') {
      const startD = new Date(endD.getTime() - 6 * 86400000);
      setStartDate(startD.toISOString().slice(0, 10));
      setEndDate(endD.toISOString().slice(0, 10));
    } else if (type === 'month') {
      const startD = new Date(endD.getTime() - 29 * 86400000);
      setStartDate(startD.toISOString().slice(0, 10));
      setEndDate(endD.toISOString().slice(0, 10));
    } else if (type === 'year') {
      setStartDate('2026-01-01');
      setEndDate('2026-12-31');
    } else if (type === 'all') {
      setStartDate(minDateStr);
      setEndDate(maxDateStr);
    }
  };

  const { prevStartDate, prevEndDate } = useMemo(() => {
    try {
      const s = new Date(startDate).getTime();
      const e = new Date(endDate).getTime();
      const diff = Math.max(86400000, e - s);
      const prevEnd = new Date(s - 86400000);
      const prevStart = new Date(prevEnd.getTime() - diff);
      return {
        prevStartDate: prevStart.toISOString().slice(0, 10),
        prevEndDate: prevEnd.toISOString().slice(0, 10)
      };
    } catch {
      return { prevStartDate: '', prevEndDate: '' };
    }
  }, [startDate, endDate]);

  const currentCalls = useMemo(() => {
    if (!calls || calls.length === 0) return [];
    if (periodType === 'all' && startDate === minDateStr && endDate === maxDateStr) {
      return calls;
    }
    return calls.filter((c) => {
      if (!c.timestamp) return false;
      const d = c.timestamp.slice(0, 10);
      return d >= startDate && d <= endDate;
    });
  }, [calls, startDate, endDate, periodType, minDateStr, maxDateStr]);

  const previousCalls = useMemo(() => {
    if (!isComparative || !calls || calls.length === 0 || !prevStartDate || !prevEndDate) return [];
    return calls.filter((c) => {
      if (!c.timestamp) return false;
      const d = c.timestamp.slice(0, 10);
      return d >= prevStartDate && d <= prevEndDate;
    });
  }, [calls, isComparative, prevStartDate, prevEndDate]);

  function computeStats(list: CallRecord[]) {
    const totalCalls = list.length;
    const incomingCalls = list.filter(c => c.type === 'incoming').length;
    const outgoingCalls = list.filter(c => c.type === 'outgoing').length;
    const completedCalls = list.filter(c => c.status === 'completed' || (c.is_answered && c.duration_seconds > 0)).length;
    const missedCalls = list.filter(c => c.status === 'missed' || !c.is_answered || c.duration_seconds === 0).length;
    const bookedCount = list.filter(c => c.booking_status === 'согласие' || c.key_facts?.call_outcome === 'запись' || c.key_facts?.call_outcome === 'успешно').length;
    const declinedCount = list.filter(c => c.booking_status === 'отказ' || c.key_facts?.call_outcome === 'отказ').length;
    const consultationCount = list.filter(c => c.booking_status === 'консультация' || c.key_facts?.call_outcome === 'консультация').length;
    const conversionRate = totalCalls > 0 ? Math.round((bookedCount / totalCalls) * 100) : 0;
    const scored = list.filter(c => typeof c.operator_score === 'number' && c.operator_score !== null && !isNaN(c.operator_score));
    const averageScore = scored.length > 0 ? parseFloat((scored.reduce((acc, c) => acc + (c.operator_score || 0), 0) / scored.length).toFixed(1)) : 0;
    const disputeCount = list.filter(c => !!c.key_facts?.is_dispute).length;
    const disputeRate = totalCalls > 0 ? Math.round((disputeCount / totalCalls) * 100) : 0;
    const avgDurationSec = totalCalls > 0 ? Math.round(list.reduce((acc, c) => acc + (c.duration_seconds || 0), 0) / totalCalls) : 0;

    return {
      totalCalls,
      incomingCalls,
      outgoingCalls,
      completedCalls,
      missedCalls,
      bookedCount,
      declinedCount,
      consultationCount,
      conversionRate,
      averageScore,
      disputeCount,
      disputeRate,
      avgDurationSec
    };
  }

  const curStats = useMemo(() => {
    if (currentCalls.length > 0) return computeStats(currentCalls);
    return {
      totalCalls: stats.totalCalls || 0,
      incomingCalls: 0,
      outgoingCalls: 0,
      completedCalls: 0,
      missedCalls: 0,
      bookedCount: 0,
      declinedCount: 0,
      consultationCount: 0,
      conversionRate: stats.successRate || 0,
      averageScore: stats.averageScore || 0,
      disputeCount: 0,
      disputeRate: stats.disputeRate || 0,
      avgDurationSec: 0
    };
  }, [currentCalls, stats]);

  const prevStats = useMemo(() => isComparative ? computeStats(previousCalls) : undefined, [previousCalls, isComparative]);

  function calcDelta(curVal: number, prevVal?: number, isPercent = false, invert = false) {
    if (prevVal === undefined || (prevVal === 0 && curVal === 0)) {
      return { text: '—', isGood: true, diff: 0, hasPrev: false };
    }
    const diff = curVal - prevVal;
    const sign = diff > 0 ? '+' : '';
    let text = isPercent ? `${sign}${diff.toFixed(1)}%` : `${sign}${diff}`;
    if (!isPercent && prevVal > 0) {
      const pct = ((diff / prevVal) * 100).toFixed(0);
      text += ` (${sign}${pct}%)`;
    }
    const isGood = invert ? diff <= 0 : diff >= 0;
    return { text, isGood, diff, hasPrev: true };
  }

  // Operator Performance and Comparative Ranking
  const operatorsData = useMemo(() => {
    const map: Record<string, {
      name: string;
      totalCalls: number;
      bookedCount: number;
      disputes: number;
      scores: number[];
      prevTotalCalls: number;
      prevBookedCount: number;
      prevScores: number[];
    }> = {};

    currentCalls.forEach((c) => {
      const name = c.operator_name || 'Дежурный администратор';
      if (!map[name]) {
        map[name] = { name, totalCalls: 0, bookedCount: 0, disputes: 0, scores: [], prevTotalCalls: 0, prevBookedCount: 0, prevScores: [] };
      }
      map[name].totalCalls++;
      if (c.booking_status === 'согласие' || c.key_facts?.call_outcome === 'запись' || c.key_facts?.call_outcome === 'успешно') {
        map[name].bookedCount++;
      }
      if (c.key_facts?.is_dispute) {
        map[name].disputes++;
      }
      if (typeof c.operator_score === 'number' && c.operator_score !== null && !isNaN(c.operator_score)) {
        map[name].scores.push(c.operator_score);
      }
    });

    if (isComparative) {
      previousCalls.forEach((c) => {
        const name = c.operator_name || 'Дежурный администратор';
        if (!map[name]) {
          map[name] = { name, totalCalls: 0, bookedCount: 0, disputes: 0, scores: [], prevTotalCalls: 0, prevBookedCount: 0, prevScores: [] };
        }
        map[name].prevTotalCalls++;
        if (c.booking_status === 'согласие' || c.key_facts?.call_outcome === 'запись' || c.key_facts?.call_outcome === 'успешно') {
          map[name].prevBookedCount++;
        }
        if (typeof c.operator_score === 'number' && c.operator_score !== null && !isNaN(c.operator_score)) {
          map[name].prevScores.push(c.operator_score);
        }
      });
    }

    return Object.values(map).map((op) => {
      const avgScore = op.scores.length > 0 ? parseFloat((op.scores.reduce((a, b) => a + b, 0) / op.scores.length).toFixed(1)) : null;
      const prevAvgScore = op.prevScores.length > 0 ? parseFloat((op.prevScores.reduce((a, b) => a + b, 0) / op.prevScores.length).toFixed(1)) : null;
      const conversionRate = op.totalCalls > 0 ? Math.round((op.bookedCount / op.totalCalls) * 100) : 0;
      const prevConversionRate = op.prevTotalCalls > 0 ? Math.round((op.prevBookedCount / op.prevTotalCalls) * 100) : 0;
      return {
        name: op.name,
        totalCalls: op.totalCalls,
        avgScore,
        bookedCount: op.bookedCount,
        conversionRate,
        disputes: op.disputes,
        prevTotalCalls: op.prevTotalCalls,
        prevAvgScore,
        prevConversionRate
      };
    }).sort((a, b) => b.totalCalls - a.totalCalls);
  }, [currentCalls, previousCalls, isComparative]);

  // Export PDF Handler
  const handleExportPeriodPdf = async () => {
    setExportingPdf(true);
    setExportError(null);
    setExportSuccess(false);
    try {
      const periodTitles: Record<string, string> = {
        week: 'Неделя',
        month: 'Месяц',
        year: 'Год (2026)',
        all: 'Все время',
        custom: 'Произвольный период'
      };

      const reportData: PeriodStatsReportData = {
        periodTitle: periodTitles[periodType] || 'Выбранный период',
        periodDates: `${startDate} — ${endDate}`,
        isComparative,
        comparePeriodTitle: isComparative ? 'Предыдущий аналогичный период' : undefined,
        compareDates: isComparative ? `${prevStartDate} — ${prevEndDate}` : undefined,
        currentStats: curStats,
        previousStats: prevStats,
        operators: operatorsData,
        hourlyPeakHours: '11:00 — 16:00',
        userRole
      };

      const res = await fetch('/api/reports/period-stats-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify(reportData)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Ошибка сервера (${res.status})`);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Otchet_Lik28_${periodType}_${startDate}_${endDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 4000);
    } catch (err: any) {
      setExportError(err.message || 'Сбой при формировании PDF отчета');
    } finally {
      setExportingPdf(false);
    }
  };

  // Heatmap states
  const [viewMode, setViewMode] = useState<'heatmap' | 'chart'>('heatmap');
  const [hourRange, setHourRange] = useState<'work' | 'full'>('work'); // 'work': 8..21, 'full': 0..23
  const [metricType, setMetricType] = useState<'all' | 'booked' | 'disputes' | 'score'>('all');
  const [hoveredCell, setHoveredCell] = useState<CellData | null>(null);
  const [isHeatmapExpanded, setIsHeatmapExpanded] = useState(true);

  // Sentiment Trend states
  const [sentimentDaysCount, setSentimentDaysCount] = useState<7 | 10>(7);
  const [sentimentUnit, setSentimentUnit] = useState<'percent' | 'count'>('percent');
  const [isSentimentExpanded, setIsSentimentExpanded] = useState(true);
  const [showNeutralLine, setShowNeutralLine] = useState(false);

  // 1. Dynamic KPI Summary Cards
  const cards = [
    {
      id: 'stats-total',
      title: 'Всего звонков',
      value: curStats.totalCalls,
      subtitle: `${curStats.incomingCalls} вход. / ${curStats.outgoingCalls} исход.`,
      icon: Phone,
      color: 'bg-blue-50 text-blue-600 border-blue-100',
      progress: 100,
      progressColor: 'bg-blue-600',
      delta: prevStats ? calcDelta(curStats.totalCalls, prevStats.totalCalls) : null,
      prevValue: prevStats ? `${prevStats.totalCalls} вызовов` : null,
    },
    {
      id: 'stats-dispute',
      title: 'Уровень споров / конфликтов',
      value: `${curStats.disputeRate}%`,
      subtitle: curStats.disputeRate > 20 ? 'Требует внимания' : 'В пределах нормы',
      icon: AlertTriangle,
      color: curStats.disputeRate > 20 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-amber-50 text-amber-600 border-amber-100',
      progress: curStats.disputeRate,
      progressColor: curStats.disputeRate > 20 ? 'bg-red-500' : 'bg-amber-500',
      delta: prevStats ? calcDelta(curStats.disputeRate, prevStats.disputeRate, true, true) : null,
      prevValue: prevStats ? `${prevStats.disputeRate}%` : null,
    },
    {
      id: 'stats-score',
      title: 'Средний балл операторов',
      value: `${curStats.averageScore} / 10`,
      subtitle: curStats.averageScore >= 8 ? 'Высокое качество' : 'Рекомендуется тренинг',
      icon: Star,
      color: curStats.averageScore >= 8 ? 'bg-green-50 text-green-600 border-green-100' : 'bg-orange-50 text-orange-600 border-orange-100',
      progress: curStats.averageScore * 10,
      progressColor: curStats.averageScore >= 8 ? 'bg-green-500' : 'bg-orange-500',
      delta: prevStats ? calcDelta(curStats.averageScore, prevStats.averageScore) : null,
      prevValue: prevStats ? `${prevStats.averageScore} / 10` : null,
    },
    {
      id: 'stats-success',
      title: 'Успешность (Конверсия)',
      value: `${curStats.conversionRate}%`,
      subtitle: `${curStats.bookedCount} записей из ${curStats.totalCalls}`,
      icon: CheckCircle,
      color: 'bg-emerald-50 text-emerald-600 border-emerald-100',
      progress: curStats.conversionRate,
      progressColor: 'bg-emerald-500',
      delta: prevStats ? calcDelta(curStats.conversionRate, prevStats.conversionRate, true) : null,
      prevValue: prevStats ? `${prevStats.conversionRate}%` : null,
    },
  ];

  // ==========================================
  // 2. SENTIMENT & LOYALTY TRENDS (7 DAYS)
  // ==========================================
  const { 
    sentimentTrendsData, 
    sentimentAverages, 
    loyaltyTrendDirection, 
    sentimentInsight 
  } = useMemo(() => {
    // If calls are provided, calculate dynamically
    let allDays: SentimentTrendItem[] = [];

    if (calls && calls.length > 0) {
      const dayMap: Record<string, {
        dateKey: string;
        total: number;
        positive: number;
        negative: number;
        neutral: number;
        disputes: number;
        scores: number[];
      }> = {};

      calls.forEach((c) => {
        if (!c.timestamp) return;
        const d = new Date(c.timestamp);
        if (isNaN(d.getTime())) return;
        // Europe/Samara is UTC+4
        const samaraDate = new Date(d.getTime() + 4 * 3600 * 1000);
        const dateKey = samaraDate.toISOString().slice(0, 10);

        if (!dayMap[dateKey]) {
          dayMap[dateKey] = {
            dateKey,
            total: 0,
            positive: 0,
            negative: 0,
            neutral: 0,
            disputes: 0,
            scores: []
          };
        }

        const entry = dayMap[dateKey];
        entry.total += 1;

        const tc = (c.key_facts?.tone_client || '').toLowerCase();
        const score = typeof c.operator_score === 'number' && !isNaN(c.operator_score) ? c.operator_score : null;
        const isDispute = !!c.key_facts?.is_dispute;
        if (isDispute) entry.disputes += 1;
        if (score !== null) entry.scores.push(score);

        const isNegative = isDispute ||
          ['раздраженный', 'недовольный', 'агрессивный', 'конфликтный', 'грубый'].some(t => tc.includes(t)) ||
          (score !== null && score > 0 && score <= 4);

        const isPositive = !isNegative && (
          ['дружелюбный', 'позитивный', 'благодарный', 'радостный', 'довольный'].some(t => tc.includes(t)) ||
          (score !== null && score >= 8) ||
          (c.booking_status === 'согласие' || c.key_facts?.call_outcome === 'запись')
        );

        if (isNegative) {
          entry.negative += 1;
        } else if (isPositive) {
          entry.positive += 1;
        } else {
          entry.neutral += 1;
        }
      });

      const sortedDayKeys = Object.keys(dayMap).sort();
      const russianDayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
      const russianMonthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

      allDays = sortedDayKeys.map((key) => {
        const d = dayMap[key];
        const dParts = new Date(key + 'T12:00:00Z');
        const dayOfWeek = russianDayNames[dParts.getUTCDay()];
        const dayNum = dParts.getUTCDate();
        const month = russianMonthNames[dParts.getUTCMonth()];

        const posPct = d.total > 0 ? Math.round((d.positive / d.total) * 100) : 0;
        const negPct = d.total > 0 ? Math.round((d.negative / d.total) * 100) : 0;
        const neuPct = d.total > 0 ? Math.max(0, 100 - posPct - negPct) : 0;
        const nsi = posPct - negPct; // Net Sentiment Index
        const avgScore = d.scores.length > 0 
          ? Number((d.scores.reduce((a, b) => a + b, 0) / d.scores.length).toFixed(1)) 
          : null;

        return {
          dateKey: d.dateKey,
          label: `${dayOfWeek}, ${dayNum} ${month}`,
          shortLabel: `${dayNum} ${month}`,
          dayOfWeek,
          total: d.total,
          positive: d.positive,
          negative: d.negative,
          neutral: d.neutral,
          posPct,
          negPct,
          neuPct,
          nsi,
          avgScore,
          disputes: d.disputes
        };
      });
    } else if (stats.sentimentTrends && stats.sentimentTrends.length > 0) {
      allDays = stats.sentimentTrends;
    }

    // Default fallback if no data
    if (allDays.length === 0) {
      return {
        sentimentTrendsData: [],
        sentimentAverages: { avgPos: 0, avgNeg: 0, avgNsi: 0, avgScore: 0, totalCalls: 0 },
        loyaltyTrendDirection: 'neutral',
        sentimentInsight: 'Недостаточно данных для анализа тональности за 7 дней.'
      };
    }

    // Slice for selected days (7 or 10)
    const selectedDays = sentimentDaysCount === 7 ? allDays.slice(-7) : allDays;

    // Calculate averages across the selected window
    let sumTotal = 0;
    let sumPos = 0;
    let sumNeg = 0;
    let scoreSum = 0;
    let scoreDays = 0;

    selectedDays.forEach((d) => {
      sumTotal += d.total;
      sumPos += d.positive;
      sumNeg += d.negative;
      if (d.avgScore !== null) {
        scoreSum += d.avgScore;
        scoreDays += 1;
      }
    });

    const avgPos = sumTotal > 0 ? Math.round((sumPos / sumTotal) * 100) : 0;
    const avgNeg = sumTotal > 0 ? Math.round((sumNeg / sumTotal) * 100) : 0;
    const avgNsi = avgPos - avgNeg;
    const avgScore = scoreDays > 0 ? Number((scoreSum / scoreDays).toFixed(1)) : stats.averageScore;

    // Calculate Trend Direction (compare last 3 days with earlier days)
    let trendDir: 'up' | 'down' | 'neutral' = 'neutral';
    if (selectedDays.length >= 4) {
      const splitIdx = Math.floor(selectedDays.length / 2);
      const firstHalf = selectedDays.slice(0, splitIdx);
      const secondHalf = selectedDays.slice(splitIdx);

      const firstPos = firstHalf.reduce((a, b) => a + b.posPct, 0) / firstHalf.length;
      const secondPos = secondHalf.reduce((a, b) => a + b.posPct, 0) / secondHalf.length;

      if (secondPos - firstPos >= 5) trendDir = 'up';
      else if (firstPos - secondPos >= 5) trendDir = 'down';
    }

    // Insight text
    let insightText = '';
    if (trendDir === 'up') {
      insightText = `📈 Положительная динамика клиентской лояльности: доля позитивных диалогов выросла до ${avgPos}%, а негативные обращения сведены к минимуму (${avgNeg}%). Клиенты довольны быстрым подбором окон для записи.`;
    } else if (trendDir === 'down') {
      insightText = `⚠️ Зафиксировано снижение позитивной тональности. Рекомендуется обратить внимание на стандарты приветствия и вежливости операторов в часы пиковой нагрузки.`;
    } else {
      insightText = `⚖️ Стабильный уровень удовлетворенности: индекс лояльности NSI составляет +${avgNsi}%. Звонки проходят в ровном, уважительном деловом ключе.`;
    }

    return {
      sentimentTrendsData: selectedDays,
      sentimentAverages: {
        avgPos,
        avgNeg,
        avgNsi,
        avgScore,
        totalCalls: sumTotal
      },
      loyaltyTrendDirection: trendDir,
      sentimentInsight: insightText
    };
  }, [calls, stats.sentimentTrends, stats.averageScore, sentimentDaysCount]);

  // ==========================================
  // 3. HEATMAP DATA (24h x 7 Days)
  // ==========================================
  const hours = useMemo(() => {
    if (hourRange === 'work') {
      return Array.from({ length: 14 }, (_, i) => i + 8); // 8 to 21
    }
    return Array.from({ length: 24 }, (_, i) => i); // 0 to 23
  }, [hourRange]);

  const { matrix, hourlyAggregates, maxCellCalls, peakHour, busiestDay, eveningRushCount } = useMemo(() => {
    const mat: CellData[][] = RUSSIAN_DAYS.map((dayName, dayIndex) => {
      return Array.from({ length: 24 }, (_, hour) => {
        const hourStr = `${hour.toString().padStart(2, '0')}:00`;
        const nextHourStr = `${((hour + 1) % 24).toString().padStart(2, '0')}:00`;
        return {
          dayIndex,
          dayName,
          dayFullName: RUSSIAN_DAY_FULL_NAMES[dayIndex],
          hour,
          hourLabel: `${hourStr} – ${nextHourStr}`,
          totalCalls: 0,
          bookedCalls: 0,
          disputeCalls: 0,
          avgScore: null,
        };
      });
    });

    const scoresTracker: number[][][] = Array.from({ length: 7 }, () => 
      Array.from({ length: 24 }, () => [])
    );

    const hourlyAggs = Array.from({ length: 24 }, (_, h) => {
      const hStr = `${h.toString().padStart(2, '0')}:00`;
      return {
        hour: h,
        hourLabel: hStr,
        fullLabel: `${hStr} – ${((h + 1) % 24).toString().padStart(2, '0')}:00`,
        total: 0,
        booked: 0,
        disputes: 0,
        scoreSum: 0,
        scoreCount: 0,
        avgScore: 0,
      };
    });

    let maxCalls = 0;
    const dayTotals = [0, 0, 0, 0, 0, 0, 0];

    calls.forEach((c) => {
      if (!c.timestamp) return;
      const date = new Date(c.timestamp);
      if (isNaN(date.getTime())) return;
      const samaraDate = new Date(date.getTime() + 4 * 60 * 60 * 1000);
      const utcDay = samaraDate.getUTCDay();
      const dayIdx = utcDay === 0 ? 6 : utcDay - 1;
      const hour = samaraDate.getUTCHours();

      if (dayIdx >= 0 && dayIdx < 7 && hour >= 0 && hour < 24) {
        const cell = mat[dayIdx][hour];
        cell.totalCalls += 1;
        dayTotals[dayIdx] += 1;

        const isBooked = c.booking_status === 'согласие' || c.key_facts?.call_outcome === 'запись';
        if (isBooked) cell.bookedCalls += 1;

        if (c.key_facts?.is_dispute) cell.disputeCalls += 1;

        if (c.operator_score !== null && c.operator_score !== undefined) {
          scoresTracker[dayIdx][hour].push(c.operator_score);
        }

        hourlyAggs[hour].total += 1;
        if (isBooked) hourlyAggs[hour].booked += 1;
        if (c.key_facts?.is_dispute) hourlyAggs[hour].disputes += 1;
        if (c.operator_score !== null && c.operator_score !== undefined) {
          hourlyAggs[hour].scoreSum += c.operator_score;
          hourlyAggs[hour].scoreCount += 1;
        }

        if (cell.totalCalls > maxCalls) {
          maxCalls = cell.totalCalls;
        }
      }
    });

    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const scs = scoresTracker[d][h];
        if (scs.length > 0) {
          const sum = scs.reduce((a, b) => a + b, 0);
          mat[d][h].avgScore = Math.round((sum / scs.length) * 10) / 10;
        }
      }
    }

    hourlyAggs.forEach(h => {
      if (h.scoreCount > 0) {
        h.avgScore = Math.round((h.scoreSum / h.scoreCount) * 10) / 10;
      }
    });

    let maxHourIdx = 0;
    let maxHourCalls = 0;
    hourlyAggs.forEach((h, idx) => {
      if (h.total > maxHourCalls) {
        maxHourCalls = h.total;
        maxHourIdx = idx;
      }
    });

    let peakDayIdx = 0;
    let maxDayCalls = 0;
    dayTotals.forEach((total, idx) => {
      if (total > maxDayCalls) {
        maxDayCalls = total;
        peakDayIdx = idx;
      }
    });

    const eveningRush = hourlyAggs[16].total + hourlyAggs[17].total + hourlyAggs[18].total;

    return {
      matrix: mat,
      hourlyAggregates: hourlyAggs,
      maxCellCalls: maxCalls || 1,
      peakHour: {
        hour: maxHourIdx,
        calls: maxHourCalls,
        label: `${maxHourIdx.toString().padStart(2, '0')}:00 – ${((maxHourIdx + 1) % 24).toString().padStart(2, '0')}:00`
      },
      busiestDay: {
        name: RUSSIAN_DAY_FULL_NAMES[peakDayIdx],
        shortName: RUSSIAN_DAYS[peakDayIdx],
        calls: maxDayCalls
      },
      eveningRushCount: eveningRush
    };
  }, [calls]);

  const d3ColorScale = useMemo(() => {
    return d3.scaleSequential()
      .domain([0, Math.max(maxCellCalls, 5)])
      .interpolator(d3.interpolateYlOrRd);
  }, [maxCellCalls]);

  const getCellValue = (cell: CellData) => {
    switch (metricType) {
      case 'booked': return cell.bookedCalls;
      case 'disputes': return cell.disputeCalls;
      case 'score': return cell.avgScore ?? 0;
      default: return cell.totalCalls;
    }
  };

  const getCellColor = (cell: CellData) => {
    const val = getCellValue(cell);
    if (val === 0) return '#f8fafc';

    if (metricType === 'score') {
      if (cell.avgScore === null) return '#f8fafc';
      if (cell.avgScore >= 8) return '#dcfce7';
      if (cell.avgScore >= 6) return '#fef3c7';
      return '#fee2e2';
    }

    if (metricType === 'disputes') {
      if (val === 0) return '#f8fafc';
      if (val === 1) return '#fef3c7';
      if (val === 2) return '#fed7aa';
      return '#fca5a5';
    }

    if (metricType === 'booked') {
      const bookedScale = d3.scaleSequential()
        .domain([0, Math.max(maxCellCalls * 0.6, 3)])
        .interpolator(d3.interpolateBuGn);
      return bookedScale(val);
    }

    return d3ColorScale(val);
  };

  const getCellTextColor = (cell: CellData) => {
    const val = getCellValue(cell);
    if (val === 0) return '#94a3b8';
    if (metricType === 'all') {
      const ratio = val / maxCellCalls;
      return ratio > 0.55 ? '#ffffff' : '#334155';
    }
    if (metricType === 'booked') {
      return val >= 4 ? '#ffffff' : '#065f46';
    }
    return '#1e293b';
  };

  const chartData = useMemo(() => {
    return hourlyAggregates.filter(h => hours.includes(h.hour)).map(h => ({
      ...h,
      isPeak: h.total >= 35,
      otherCalls: Math.max(0, h.total - h.booked - h.disputes)
    }));
  }, [hourlyAggregates, hours]);

  const avgHourlyCalls = useMemo(() => {
    const total = chartData.reduce((acc, h) => acc + h.total, 0);
    return chartData.length > 0 ? Math.round(total / chartData.length) : 0;
  }, [chartData]);

  return (
    <div className="space-y-4" id="stats-grid-wrapper">
      {/* 0. Period Selector, Comparative Analysis & PDF Export Header Panel */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs" id="period-selector-panel">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-200">
                <Calendar className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                Период статистики и аналитики
              </h2>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono">
                {currentCalls.length} вызовов
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Выборка звонков салона «Лик 28» по периодам (неделя, месяц, год, произвольный период) со сравнительным анализом и выгрузкой в PDF.
            </p>
          </div>

          {/* PDF Export Button */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportPeriodPdf}
              disabled={exportingPdf}
              id="btn-export-period-pdf"
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors"
            >
              {exportingPdf ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Формирование PDF...</span>
                </>
              ) : exportSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-white" />
                  <span>Отчет скачан!</span>
                </>
              ) : (
                <>
                  <FileDown className="w-3.5 h-3.5" />
                  <span>Выгрузить отчет в PDF</span>
                </>
              )}
            </button>
          </div>
        </div>

        {exportError && (
          <div className="mt-3 p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center justify-between">
            <span>{exportError}</span>
            <button onClick={() => setExportError(null)} className="text-rose-500 hover:text-rose-700 font-bold ml-2">×</button>
          </div>
        )}

        {/* Toolbar controls */}
        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          {/* Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500 mr-1 flex items-center gap-1">
              <SlidersHorizontal className="w-3 h-3" /> Период:
            </span>
            {[
              { id: 'week', label: 'Неделя' },
              { id: 'month', label: 'Месяц' },
              { id: 'year', label: 'Год' },
              { id: 'custom', label: 'Произвольный' },
              { id: 'all', label: 'Все звонки' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelectPreset(p.id as any)}
                id={`btn-period-${p.id}`}
                className={`px-3 py-1.5 text-xs rounded-lg font-semibold transition-all ${
                  periodType === p.id
                    ? 'bg-slate-900 text-white shadow-3xs'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Date Picker inputs and Comparative Switch */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
              <span className="text-[11px] text-slate-400 font-medium">с</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPeriodType('custom');
                }}
                className="bg-transparent text-xs font-bold text-slate-800 focus:outline-hidden"
              />
              <span className="text-[11px] text-slate-400 font-medium">по</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPeriodType('custom');
                }}
                className="bg-transparent text-xs font-bold text-slate-800 focus:outline-hidden"
              />
            </div>

            {/* Comparative Analysis Toggle */}
            <button
              onClick={() => setIsComparative(!isComparative)}
              id="btn-toggle-comparative"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                isComparative
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-3xs'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              title="Сравнить метрики с предыдущим периодом такой же длительности"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>Сравнительный анализ</span>
              {isComparative && (
                <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
              )}
            </button>
          </div>
        </div>

        {/* Comparative Analysis Notice Banner */}
        {isComparative && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 p-3 bg-linear-to-r from-indigo-50/80 via-blue-50/50 to-purple-50/50 border border-indigo-200 rounded-xl text-xs text-indigo-900 flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2">
              <span className="p-1 bg-indigo-600 text-white rounded-md text-[10px] font-bold">VS</span>
              <span>
                <strong>Сравнительный режим:</strong> Текущий период (<strong>{startDate} — {endDate}</strong>) сравнивается с предыдущим периодом (<strong>{prevStartDate} — {prevEndDate}</strong>).
              </span>
            </div>
            <span className="text-[11px] font-mono text-indigo-700 bg-white/80 px-2 py-0.5 rounded border border-indigo-200">
              Звонков в пред. периоде: {previousCalls.length}
            </span>
          </motion.div>
        )}
      </div>

      {/* 1. Main KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" id="stats-grid-container">
        {cards.map((card, index) => {
          const IconComponent = card.icon;
          return (
            <motion.div
              key={card.id}
              id={card.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              className="bg-white border border-slate-100 rounded-xl p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow duration-200"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{card.title}</p>
                  <h3 className="text-2xl font-bold text-slate-900 mt-2 font-mono tracking-tight">{card.value}</h3>
                </div>
                <div className={`p-2.5 rounded-lg border ${card.color}`}>
                  <IconComponent className="w-5 h-5" />
                </div>
              </div>
              
              <div className="mt-4">
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <motion.div 
                    className={`h-full rounded-full ${card.progressColor}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${card.progress}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                </div>
                <div className="flex justify-between items-center mt-2 text-xs text-slate-400">
                  <span>{card.subtitle}</span>
                  {card.id === 'stats-total' && !isComparative ? (
                    <span className="flex items-center text-emerald-600 gap-0.5 font-medium">
                      <TrendingUp className="w-3.5 h-3.5" /> +12% сегодня
                    </span>
                  ) : null}
                </div>

                {isComparative && card.delta && card.delta.hasPrev && (
                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-medium">Пред.: {card.prevValue}</span>
                    <span className={`inline-flex items-center font-bold px-2 py-0.5 rounded text-[11px] ${
                      card.delta.isGood ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}>
                      {card.delta.diff > 0 ? (
                        <ArrowUpRight className="w-3 h-3 mr-0.5" />
                      ) : card.delta.diff < 0 ? (
                        <ArrowDownRight className="w-3 h-3 mr-0.5" />
                      ) : (
                        <Minus className="w-3 h-3 mr-0.5" />
                      )}
                      {card.delta.text}
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* 2. LINEAR SENTIMENT & LOYALTY TREND CHART (RECHARTS) - LAST 7 DAYS       */}
      {/* ========================================================================= */}
      <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden" id="sentiment-trend-card">
        {/* Card Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-linear-to-r from-emerald-50/40 via-white to-indigo-50/40">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-emerald-500/10 text-emerald-600 rounded-lg border border-emerald-200">
                  <HeartHandshake className="w-4 h-4" />
                </div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <span>Динамика тональности и клиентской лояльности</span>
                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200">
                    Recharts • 7 дней
                  </span>
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Линейный тренд изменения тональности (позитив / негатив / лояльность NSI) за последние 7 дней для оценки клиентского опыта.
              </p>
            </div>

            {/* Controls Bar */}
            <div className="flex flex-wrap items-center gap-2">
              {/* 7 Days vs Full Window Toggle */}
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs shadow-3xs">
                <button
                  onClick={() => setSentimentDaysCount(7)}
                  id="btn-sentiment-7days"
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    sentimentDaysCount === 7
                      ? 'bg-emerald-600 text-white shadow-3xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Последние 7 дней"
                >
                  7 дней
                </button>
                <button
                  onClick={() => setSentimentDaysCount(10)}
                  id="btn-sentiment-all"
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    sentimentDaysCount === 10
                      ? 'bg-emerald-600 text-white shadow-3xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Все дни выборки"
                >
                  Весь период
                </button>
              </div>

              {/* Units: Percent vs Count */}
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs shadow-3xs">
                <button
                  onClick={() => setSentimentUnit('percent')}
                  id="btn-sentiment-unit-pct"
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    sentimentUnit === 'percent'
                      ? 'bg-slate-900 text-white shadow-3xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Доля (%)
                </button>
                <button
                  onClick={() => setSentimentUnit('count')}
                  id="btn-sentiment-unit-count"
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    sentimentUnit === 'count'
                      ? 'bg-slate-900 text-white shadow-3xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Звонки (шт)
                </button>
              </div>

              {/* Show/Hide Neutral Line Toggle */}
              <button
                onClick={() => setShowNeutralLine(!showNeutralLine)}
                className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                  showNeutralLine 
                    ? 'bg-slate-100 border-slate-300 text-slate-800' 
                    : 'bg-white border-slate-200 text-slate-500 hover:text-slate-700'
                }`}
                title="Показать/скрыть нейтральные звонки"
              >
                Нейтральные
              </button>

              {/* Collapse/Expand */}
              <button
                onClick={() => setIsSentimentExpanded(!isSentimentExpanded)}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors"
                title={isSentimentExpanded ? "Свернуть график" : "Развернуть график"}
              >
                {isSentimentExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* 4 Sentiment Summary KPI Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4 pt-3.5 border-t border-slate-100/80">
            {/* Positive */}
            <div className="bg-white/80 border border-slate-200/80 rounded-xl p-2.5 flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 shrink-0">
                <Smile className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-bold text-slate-400">Позитивная тональность</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold text-slate-900 font-mono">
                    {sentimentAverages.avgPos}%
                  </p>
                  {loyaltyTrendDirection === 'up' && (
                    <span className="flex items-center text-[10px] text-emerald-600 font-bold">
                      <TrendingUp className="w-3 h-3" /> Рост
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-emerald-600 font-medium">Клиенты выразили согласие/благодарность</p>
              </div>
            </div>

            {/* Negative / Disputes */}
            <div className="bg-white/80 border border-slate-200/80 rounded-xl p-2.5 flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-rose-50 text-rose-600 shrink-0">
                <Frown className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-bold text-slate-400">Негатив / Риск оттока</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold text-slate-900 font-mono">
                    {sentimentAverages.avgNeg}%
                  </p>
                  <span className="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-emerald-50 text-emerald-700">
                    Норма
                  </span>
                </div>
                <p className="text-[10px] text-rose-600 font-medium">Спорные ситуации и возражения</p>
              </div>
            </div>

            {/* Net Sentiment Index (NSI) */}
            <div className="bg-white/80 border border-slate-200/80 rounded-xl p-2.5 flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
                <Award className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-bold text-slate-400">Индекс лояльности (NSI)</p>
                <p className="text-sm font-bold text-indigo-700 font-mono">
                  {sentimentAverages.avgNsi >= 0 ? `+${sentimentAverages.avgNsi}%` : `${sentimentAverages.avgNsi}%`}
                </p>
                <p className="text-[10px] text-indigo-600 font-medium">Баланс удовлетворенности клиентов</p>
              </div>
            </div>

            {/* Average Quality Score */}
            <div className="bg-white/80 border border-slate-200/80 rounded-xl p-2.5 flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-amber-50 text-amber-600 shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-bold text-slate-400">Качество диалогов</p>
                <p className="text-sm font-bold text-slate-900 font-mono">
                  {sentimentAverages.avgScore} / 10
                </p>
                <p className="text-[10px] text-amber-600 font-medium">Оценка вежливости оператора</p>
              </div>
            </div>
          </div>
        </div>

        {/* Expandable Line Chart Area */}
        <AnimatePresence>
          {isSentimentExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="p-4 sm:p-5 overflow-hidden"
            >
              <div className="h-64 sm:h-72 w-full pt-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={sentimentTrendsData}
                    margin={{ top: 15, right: 15, left: -15, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="shortLabel" 
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      axisLine={{ stroke: '#cbd5e1' }}
                      tickLine={false}
                    />
                    <YAxis 
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      axisLine={{ stroke: '#cbd5e1' }}
                      tickLine={false}
                      domain={sentimentUnit === 'percent' ? [0, 100] : ['auto', 'auto']}
                      unit={sentimentUnit === 'percent' ? '%' : ''}
                    />
                    <RechartsTooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload as SentimentTrendItem;
                          return (
                            <div className="bg-slate-900/95 backdrop-blur-xs text-white p-3.5 rounded-xl shadow-xl text-xs space-y-2 border border-slate-700 min-w-[220px]">
                              <div className="flex items-center justify-between border-b border-slate-700/80 pb-1.5">
                                <span className="font-bold text-amber-400 flex items-center gap-1.5">
                                  <Calendar className="w-3.5 h-3.5" />
                                  <span>{data.label}</span>
                                </span>
                                <span className="text-[10px] font-mono text-slate-400">
                                  Всего: {data.total} зв.
                                </span>
                              </div>

                              <div className="space-y-1">
                                <div className="flex justify-between items-center text-emerald-400">
                                  <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                    <span>Позитивная тональность:</span>
                                  </span>
                                  <span className="font-bold font-mono">
                                    {sentimentUnit === 'percent' ? `${data.posPct}%` : `${data.positive} зв.`}
                                  </span>
                                </div>

                                <div className="flex justify-between items-center text-rose-400">
                                  <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                                    <span>Негатив / претензии:</span>
                                  </span>
                                  <span className="font-bold font-mono">
                                    {sentimentUnit === 'percent' ? `${data.negPct}%` : `${data.negative} зв.`}
                                  </span>
                                </div>

                                {showNeutralLine && (
                                  <div className="flex justify-between items-center text-slate-300">
                                    <span className="flex items-center gap-1">
                                      <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                                      <span>Нейтральные диалоги:</span>
                                    </span>
                                    <span className="font-bold font-mono">
                                      {sentimentUnit === 'percent' ? `${data.neuPct}%` : `${data.neutral} зв.`}
                                    </span>
                                  </div>
                                )}

                                <div className="flex justify-between items-center text-indigo-300 border-t border-slate-800 pt-1 mt-1">
                                  <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                                    <span>Индекс лояльности (NSI):</span>
                                  </span>
                                  <span className="font-bold font-mono text-indigo-200">
                                    {data.nsi >= 0 ? `+${data.nsi}%` : `${data.nsi}%`}
                                  </span>
                                </div>

                                {data.avgScore !== null && (
                                  <div className="flex justify-between items-center text-amber-300">
                                    <span>Ср. оценка оператора:</span>
                                    <span className="font-bold font-mono">{data.avgScore} / 10</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Legend 
                      verticalAlign="top" 
                      align="right" 
                      wrapperStyle={{ paddingBottom: 10, fontSize: 12 }} 
                    />

                    {/* Benchmark Zero or 50% line */}
                    {sentimentUnit === 'percent' && (
                      <ReferenceLine 
                        y={50} 
                        stroke="#e2e8f0" 
                        strokeDasharray="4 4" 
                        label={{ 
                          value: 'Паритет 50%', 
                          fill: '#94a3b8', 
                          fontSize: 10, 
                          position: 'insideTopLeft' 
                        }} 
                      />
                    )}

                    {/* Positive Tone Curve */}
                    <Line 
                      type="monotone" 
                      dataKey={sentimentUnit === 'percent' ? 'posPct' : 'positive'}
                      name={sentimentUnit === 'percent' ? 'Позитивная тональность (%)' : 'Позитивные звонки (шт)'}
                      stroke="#10b981" 
                      strokeWidth={3}
                      dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#ffffff' }}
                      activeDot={{ r: 6, fill: '#10b981', strokeWidth: 2, stroke: '#ffffff' }}
                    />

                    {/* Negative Tone Curve */}
                    <Line 
                      type="monotone" 
                      dataKey={sentimentUnit === 'percent' ? 'negPct' : 'negative'}
                      name={sentimentUnit === 'percent' ? 'Негатив / споры (%)' : 'Негативные звонки (шт)'}
                      stroke="#f43f5e" 
                      strokeWidth={3}
                      dot={{ r: 4, fill: '#f43f5e', strokeWidth: 2, stroke: '#ffffff' }}
                      activeDot={{ r: 6, fill: '#f43f5e', strokeWidth: 2, stroke: '#ffffff' }}
                    />

                    {/* Net Sentiment Index (NSI) Curve */}
                    {sentimentUnit === 'percent' && (
                      <Line 
                        type="monotone" 
                        dataKey="nsi"
                        name="Индекс лояльности NSI (%)"
                        stroke="#6366f1" 
                        strokeWidth={2.5}
                        strokeDasharray="5 5"
                        dot={{ r: 3.5, fill: '#6366f1', strokeWidth: 1.5, stroke: '#ffffff' }}
                        activeDot={{ r: 6, fill: '#6366f1' }}
                      />
                    )}

                    {/* Optional Neutral Tone Curve */}
                    {showNeutralLine && (
                      <Line 
                        type="monotone" 
                        dataKey={sentimentUnit === 'percent' ? 'neuPct' : 'neutral'}
                        name={sentimentUnit === 'percent' ? 'Нейтральные (%)' : 'Нейтральные (шт)'}
                        stroke="#94a3b8" 
                        strokeWidth={2}
                        strokeDasharray="3 3"
                        dot={{ r: 3, fill: '#94a3b8' }}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Dynamic Insight Box */}
              <div className="mt-3 p-3 bg-linear-to-r from-emerald-50/70 via-slate-50 to-indigo-50/50 rounded-xl border border-slate-200/80 flex items-start gap-2.5 text-xs text-slate-700">
                <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold text-slate-800">
                    Инсайт клиентской лояльности (7 дней):
                  </p>
                  <p className="text-slate-600 mt-0.5 leading-relaxed">
                    {sentimentInsight}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ========================================================================= */}
      {/* 2.5. OPERATOR PERFORMANCE & COMPARATIVE RANKING TABLE                     */}
      {/* ========================================================================= */}
      {operatorsData && operatorsData.length > 0 && (
        <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden" id="operator-performance-card">
          <div className="p-4 sm:p-5 border-b border-slate-100 bg-linear-to-r from-blue-50/50 via-white to-indigo-50/50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-blue-500/10 text-blue-600 rounded-lg border border-blue-200">
                    <Users className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                    <span>Эффективность администраторов салона «Лик 28»</span>
                    {isComparative ? (
                      <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 border border-indigo-200">
                        Сравнительный аудит
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                        Текущий период
                      </span>
                    )}
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {isComparative
                    ? `Сравнение показателей администраторов за текущий период (${startDate} — ${endDate}) и предыдущий (${prevStartDate} — ${prevEndDate}).`
                    : `Индивидуальные показатели конверсии в запись, среднего балла качества и спорных ситуаций за выбранный период.`}
                </p>
              </div>
              <div className="text-xs text-slate-500 font-mono self-start sm:self-auto">
                Всего операторов: <strong className="text-slate-800">{operatorsData.length}</strong>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Администратор</th>
                  <th className="py-3 px-4">Звонки {isComparative ? '(тек. / пред.)' : ''}</th>
                  <th className="py-3 px-4">Записи клиентов</th>
                  <th className="py-3 px-4">Конверсия в запись {isComparative ? 'Δ' : ''}</th>
                  <th className="py-3 px-4">Ср. балл качества {isComparative ? 'Δ' : ''}</th>
                  <th className="py-3 px-4 text-center">Споры</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {operatorsData.map((op, idx) => {
                  const callsDelta = isComparative ? calcDelta(op.totalCalls, op.prevTotalCalls) : null;
                  const convDelta = isComparative ? calcDelta(op.conversionRate, op.prevConversionRate, true) : null;
                  const scoreDelta = isComparative && op.avgScore !== null && op.prevAvgScore !== null && op.prevAvgScore !== undefined
                    ? calcDelta(op.avgScore, op.prevAvgScore)
                    : null;

                  return (
                    <tr key={op.name} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            idx === 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {idx + 1}
                          </span>
                          <span className="font-bold text-slate-900">{op.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-800">{op.totalCalls}</span>
                          {isComparative && (
                            <span className="text-slate-400 text-[11px]">
                              / {op.prevTotalCalls || 0}
                            </span>
                          )}
                          {callsDelta && callsDelta.hasPrev && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                              callsDelta.isGood ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                            }`}>
                              {callsDelta.text}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-emerald-700">
                        {op.bookedCount} записей
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-bold ${op.conversionRate >= 30 ? 'text-emerald-700' : 'text-slate-700'}`}>
                            {op.conversionRate}%
                          </span>
                          {convDelta && convDelta.hasPrev && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                              convDelta.isGood ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                            }`}>
                              {convDelta.text}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <div className="flex items-center gap-1.5">
                          {op.avgScore !== null ? (
                            <>
                              <span className={`font-bold px-2 py-0.5 rounded-full text-xs ${
                                op.avgScore >= 8 ? 'bg-emerald-100 text-emerald-800' : op.avgScore >= 6 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                              }`}>
                                {op.avgScore} / 10
                              </span>
                              {scoreDelta && scoreDelta.hasPrev && (
                                <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                                  scoreDelta.isGood ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                                }`}>
                                  {scoreDelta.text}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-400 italic">нет данных</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center font-mono">
                        {op.disputes > 0 ? (
                          <span className="font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                            {op.disputes}
                          </span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden" id="call-activity-heatmap-card">
        {/* Section Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-linear-to-r from-slate-50/80 via-white to-amber-50/30">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-amber-500/10 text-amber-600 rounded-lg border border-amber-200">
                  <Activity className="w-4 h-4" />
                </div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <span>Тепловая карта активности звонков и пиковых нагрузок</span>
                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-200">
                    D3 + Recharts
                  </span>
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Почасовой анализ входящих и исходящих звонков по дням недели (Самара, UTC+4). Выявляет часы пик и перегрузку операторов.
              </p>
            </div>

            {/* Controls Bar */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Metric Type Selector */}
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs shadow-3xs">
                <button
                  onClick={() => setMetricType('all')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    metricType === 'all'
                      ? 'bg-slate-900 text-white shadow-3xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Все звонки"
                >
                  Все ({stats.totalCalls})
                </button>
                <button
                  onClick={() => setMetricType('booked')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    metricType === 'booked'
                      ? 'bg-emerald-600 text-white shadow-3xs'
                      : 'text-slate-600 hover:text-emerald-700'
                  }`}
                  title="Успешные записи"
                >
                  Записи
                </button>
                <button
                  onClick={() => setMetricType('disputes')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    metricType === 'disputes'
                      ? 'bg-rose-600 text-white shadow-3xs'
                      : 'text-slate-600 hover:text-rose-700'
                  }`}
                  title="Конфликты и претензии"
                >
                  Споры
                </button>
                <button
                  onClick={() => setMetricType('score')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    metricType === 'score'
                      ? 'bg-amber-600 text-white shadow-3xs'
                      : 'text-slate-600 hover:text-amber-700'
                  }`}
                  title="Средний балл оператора"
                >
                  Балл
                </button>
              </div>

              {/* Work Hours vs 24 Hours Toggle */}
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs shadow-3xs">
                <button
                  onClick={() => setHourRange('work')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    hourRange === 'work'
                      ? 'bg-slate-800 text-white shadow-3xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Рабочие часы салона с 08:00 до 21:00"
                >
                  08:00–21:00
                </button>
                <button
                  onClick={() => setHourRange('full')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    hourRange === 'full'
                      ? 'bg-slate-800 text-white shadow-3xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Полные 24 часа суток"
                >
                  24 ч
                </button>
              </div>

              {/* View Mode Toggle (Heatmap Matrix vs Recharts Chart) */}
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs shadow-3xs">
                <button
                  onClick={() => setViewMode('heatmap')}
                  id="btn-view-heatmap"
                  className={`px-2.5 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 ${
                    viewMode === 'heatmap'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Grid3X3 className="w-3.5 h-3.5 text-amber-600" />
                  <span>Сетка D3</span>
                </button>
                <button
                  onClick={() => setViewMode('chart')}
                  id="btn-view-chart"
                  className={`px-2.5 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 ${
                    viewMode === 'chart'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <BarChart2 className="w-3.5 h-3.5 text-indigo-600" />
                  <span>График</span>
                </button>
              </div>

              {/* Collapse/Expand Toggle */}
              <button
                onClick={() => setIsHeatmapExpanded(!isHeatmapExpanded)}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors"
                title={isHeatmapExpanded ? "Свернуть панель" : "Развернуть панель"}
              >
                {isHeatmapExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Quick Highlight Stats Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4 pt-3.5 border-t border-slate-100/80">
            <div className="bg-white/80 border border-slate-200/80 rounded-xl p-2.5 flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-rose-50 text-rose-600 shrink-0">
                <Flame className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-bold text-slate-400">Час пик звонков</p>
                <p className="text-xs font-bold text-slate-800 truncate">{peakHour.label}</p>
                <p className="text-[10px] text-rose-600 font-semibold">{peakHour.calls} вызовов суммарно</p>
              </div>
            </div>

            <div className="bg-white/80 border border-slate-200/80 rounded-xl p-2.5 flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
                <Users className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-bold text-slate-400">Вечерний натиск</p>
                <p className="text-xs font-bold text-slate-800 truncate">16:00 – 19:00</p>
                <p className="text-[10px] text-indigo-600 font-semibold">{eveningRushCount} звонков (39% потока)</p>
              </div>
            </div>

            <div className="bg-white/80 border border-slate-200/80 rounded-xl p-2.5 flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-amber-50 text-amber-600 shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-bold text-slate-400">Самый активный день</p>
                <p className="text-xs font-bold text-slate-800 truncate">{busiestDay.name}</p>
                <p className="text-[10px] text-amber-600 font-semibold">{busiestDay.calls} звонков за неделю</p>
              </div>
            </div>

            <div className="bg-white/80 border border-slate-200/80 rounded-xl p-2.5 flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 shrink-0">
                <Zap className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-bold text-slate-400">Рекомендация смены</p>
                <p className="text-xs font-bold text-emerald-800 truncate">2 оператора на линии</p>
                <p className="text-[10px] text-emerald-600 font-semibold">Пик: 10–12ч и 16–19ч</p>
              </div>
            </div>
          </div>
        </div>

        {/* Expandable Heatmap Content */}
        <AnimatePresence>
          {isHeatmapExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="p-4 sm:p-5 overflow-hidden"
            >
              {viewMode === 'heatmap' ? (
                /* VIEW 1: D3 Interactive Heatmap Grid (Days x Hours) */
                <div className="space-y-4">
                  {/* Heatmap Container */}
                  <div className="overflow-x-auto pb-2">
                    <div className="min-w-[620px]">
                      {/* Grid Header (Hours) */}
                      <div className="flex items-center text-[10px] font-bold text-slate-400 mb-1.5">
                        <div className="w-10 shrink-0 text-left pl-1">День</div>
                        <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}>
                          {hours.map((hour) => (
                            <div key={hour} className="text-center font-mono text-slate-500">
                              {hour}:00
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Grid Rows (Days) */}
                      <div className="space-y-1.5">
                        {RUSSIAN_DAYS.map((dayLabel, dayIndex) => {
                          const isWeekend = dayIndex >= 5;
                          return (
                            <div key={dayLabel} className="flex items-center gap-1.5">
                              {/* Day Label */}
                              <div className={`w-10 shrink-0 text-xs font-bold pl-1 ${isWeekend ? 'text-amber-700 font-extrabold' : 'text-slate-600'}`}>
                                {dayLabel}
                              </div>

                              {/* Hour Cells */}
                              <div 
                                className="flex-1 grid gap-1"
                                style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}
                              >
                                {hours.map((hour) => {
                                  const cell = matrix[dayIndex][hour];
                                  const val = getCellValue(cell);
                                  const bgColor = getCellColor(cell);
                                  const textColor = getCellTextColor(cell);
                                  const isPeakCell = cell.totalCalls >= 10;

                                  return (
                                    <div
                                      key={hour}
                                      onMouseEnter={() => setHoveredCell(cell)}
                                      onMouseLeave={() => setHoveredCell(null)}
                                      className={`h-7 sm:h-8 rounded-md flex items-center justify-center text-xs font-mono font-bold cursor-pointer transition-all duration-150 relative border ${
                                        isPeakCell ? 'border-amber-400/60 shadow-3xs ring-1 ring-amber-300/40' : 'border-slate-200/50'
                                      } hover:scale-105 hover:z-10 hover:shadow-md`}
                                      style={{
                                        backgroundColor: bgColor,
                                        color: textColor,
                                      }}
                                    >
                                      {val > 0 ? (metricType === 'score' ? (cell.avgScore ?? '—') : val) : '·'}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Heatmap Legend & Tooltip Summary Bar */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                    {/* Live Hover Info */}
                    <div className="flex items-center gap-2">
                      <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      {hoveredCell ? (
                        <div className="flex items-center gap-2 text-slate-800">
                          <span className="font-bold text-amber-700">{hoveredCell.dayFullName}, {hoveredCell.hourLabel}:</span>
                          <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-semibold font-mono">
                            Всего: {hoveredCell.totalCalls}
                          </span>
                          <span className="bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded font-semibold font-mono">
                            Записей: {hoveredCell.bookedCalls}
                          </span>
                          {hoveredCell.disputeCalls > 0 && (
                            <span className="bg-rose-50 text-rose-800 px-2 py-0.5 rounded font-semibold font-mono">
                              Споров: {hoveredCell.disputeCalls}
                            </span>
                          )}
                          {hoveredCell.avgScore !== null && (
                            <span className="bg-amber-50 text-amber-800 px-2 py-0.5 rounded font-semibold font-mono">
                              Балл: {hoveredCell.avgScore}/10
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">Наведите на ячейку для детальной информации по нагрузке</span>
                      )}
                    </div>

                    {/* D3 Color Legend Scale */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Шкала нагрузки:</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-400">0</span>
                        <div className="flex h-3 w-36 rounded-md overflow-hidden border border-slate-200 shadow-3xs">
                          {Array.from({ length: 8 }).map((_, i) => {
                            const val = (i / 7) * maxCellCalls;
                            return (
                              <div
                                key={i}
                                className="flex-1"
                                style={{ backgroundColor: d3ColorScale(val) }}
                              />
                            );
                          })}
                        </div>
                        <span className="text-[10px] text-slate-600 font-bold">{maxCellCalls}+ вызовов</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* VIEW 2: Recharts Hourly Peak Load Chart */
                <div className="space-y-4">
                  <div className="h-64 sm:h-72 w-full pt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={chartData}
                        margin={{ top: 15, right: 10, left: -15, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="hourLabel" 
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          axisLine={{ stroke: '#cbd5e1' }}
                          tickLine={false}
                        />
                        <YAxis 
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          axisLine={{ stroke: '#cbd5e1' }}
                          tickLine={false}
                        />
                        <RechartsTooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-slate-900/95 backdrop-blur-xs text-white p-3 rounded-xl shadow-xl text-xs space-y-1.5 border border-slate-700 min-w-[200px]">
                                  <div className="flex items-center justify-between border-b border-slate-700/80 pb-1">
                                    <span className="font-bold text-amber-400 font-mono">{data.fullLabel}</span>
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                      data.isPeak ? 'bg-rose-500 text-white' : 'bg-slate-700 text-slate-300'
                                    }`}>
                                      {data.isPeak ? 'Пик' : 'Штатно'}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center text-slate-200">
                                    <span>Всего вызовов:</span>
                                    <span className="font-bold font-mono text-white text-sm">{data.total}</span>
                                  </div>
                                  <div className="flex justify-between items-center text-emerald-400">
                                    <span>Записей клиентов:</span>
                                    <span className="font-bold font-mono">{data.booked}</span>
                                  </div>
                                  {data.disputes > 0 && (
                                    <div className="flex justify-between items-center text-rose-400">
                                      <span>Конфликтов/споров:</span>
                                      <span className="font-bold font-mono">{data.disputes}</span>
                                    </div>
                                  )}
                                  <div className="flex justify-between items-center text-amber-300">
                                    <span>Ср. балл оператора:</span>
                                    <span className="font-bold font-mono">{data.avgScore > 0 ? `${data.avgScore}/10` : '—'}</span>
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <ReferenceLine 
                          y={avgHourlyCalls} 
                          stroke="#94a3b8" 
                          strokeDasharray="4 4" 
                          label={{ 
                            value: `Ср. нагрузка: ${avgHourlyCalls}`, 
                            fill: '#64748b', 
                            fontSize: 10, 
                            position: 'insideTopRight' 
                          }} 
                        />
                        <Bar 
                          dataKey="total" 
                          radius={[6, 6, 0, 0]}
                        >
                          {chartData.map((entry, index) => {
                            const color = d3ColorScale(entry.total / 1.5);
                            return (
                              <Cell 
                                key={`cell-${index}`} 
                                fill={entry.isPeak ? '#e11d48' : (color || '#6366f1')} 
                              />
                            );
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-600"></span>
                        <span>Пиковые часы (≥35 вызовов/ч)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                        <span>Умеренная нагрузка</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-0.5 border-t-2 border-dashed border-slate-400"></span>
                        <span>Среднечасовая линия ({avgHourlyCalls} зв./ч)</span>
                      </div>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">
                      Салон красоты «Лик 28» • График работы 09:00 – 21:00
                    </span>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
