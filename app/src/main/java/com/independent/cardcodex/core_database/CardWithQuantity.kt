package com.independent.cardcodex.core_database

import androidx.room.Embedded

data class CardWithQuantity(
    @Embedded val card: CardEntity,
    val quantity: Int
)
