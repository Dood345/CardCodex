package com.independent.cardcodex.core_database

import androidx.room.Embedded

data class CardWithDeckQuantity(
    @Embedded val card: CardEntity,
    val quantity: Int
)
