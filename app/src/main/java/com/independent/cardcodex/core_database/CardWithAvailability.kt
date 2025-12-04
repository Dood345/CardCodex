package com.independent.cardcodex.core_database

import androidx.room.Embedded

data class CardWithAvailability(
    @Embedded val card: CardEntity,
    val totalQuantity: Int,
    val availableQuantity: Int
)
