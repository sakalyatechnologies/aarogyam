package com.aarogyam.staff.analytics

/**
 * Which money series the chart shows: income and expenses with the net, or one of them alone. Net
 * is income less expenses for each period and can go below zero.
 */
enum class MoneySeries { All, Income, Expenses, Net }
