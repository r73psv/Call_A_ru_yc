/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { Phone, AlertTriangle, Star, CheckCircle, TrendingUp } from 'lucide-react';
import { DashboardStats } from '../types.js';

interface StatsGridProps {
  stats: DashboardStats;
}

export function StatsGrid({ stats }: StatsGridProps) {
  const cards = [
    {
      id: 'stats-total',
      title: 'Всего звонков',
      value: stats.totalCalls,
      subtitle: 'Проанализировано ИИ',
      icon: Phone,
      color: 'bg-blue-50 text-blue-600 border-blue-100',
      progress: 100,
      progressColor: 'bg-blue-600',
    },
    {
      id: 'stats-dispute',
      title: 'Уровень споров / конфликтов',
      value: `${stats.disputeRate}%`,
      subtitle: stats.disputeRate > 20 ? 'Требует внимания' : 'В пределах нормы',
      icon: AlertTriangle,
      color: stats.disputeRate > 20 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-amber-50 text-amber-600 border-amber-100',
      progress: stats.disputeRate,
      progressColor: stats.disputeRate > 20 ? 'bg-red-500' : 'bg-amber-500',
    },
    {
      id: 'stats-score',
      title: 'Средний балл операторов',
      value: `${stats.averageScore} / 10`,
      subtitle: stats.averageScore >= 8 ? 'Высокое качество' : 'Рекомендуется тренинг',
      icon: Star,
      color: stats.averageScore >= 8 ? 'bg-green-50 text-green-600 border-green-100' : 'bg-orange-50 text-orange-600 border-orange-100',
      progress: stats.averageScore * 10,
      progressColor: stats.averageScore >= 8 ? 'bg-green-500' : 'bg-orange-500',
    },
    {
      id: 'stats-success',
      title: 'Успешность (Конверсия)',
      value: `${stats.successRate}%`,
      subtitle: 'Звонки с успешным исходом',
      icon: CheckCircle,
      color: 'bg-emerald-50 text-emerald-600 border-emerald-100',
      progress: stats.successRate,
      progressColor: 'bg-emerald-500',
    },
  ];

  return (
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
                {card.id === 'stats-total' ? (
                  <span className="flex items-center text-emerald-600 gap-0.5">
                    <TrendingUp className="w-3.5 h-3.5" /> +12% сегодня
                  </span>
                ) : null}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
