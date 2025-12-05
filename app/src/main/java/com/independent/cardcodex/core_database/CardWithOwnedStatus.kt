package com.independent.cardcodex.core_database

import androidx.room.Embedded

data class CardWithOwnedStatus(
    @Embedded val card: CardEntity,
    val isOwned: Boolean
)
