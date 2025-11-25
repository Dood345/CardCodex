package com.independent.cardcodex.core_database

import androidx.room.Embedded

data class SpeciesCollectionStatus(
    @Embedded val species: SpeciesEntity,
    val isOwned: Boolean
)
