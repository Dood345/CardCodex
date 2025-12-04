package com.independent.cardcodex.core_database

import androidx.room.TypeConverter
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.independent.cardcodex.data.Ability
import com.independent.cardcodex.data.Attack
import com.independent.cardcodex.data.Legalities
import com.independent.cardcodex.data.Weakness

class CardConverters {
    private val gson = Gson()

    @TypeConverter
    fun fromAbilityList(value: List<Ability>?): String {
        if (value == null) return ""
        val type = object : TypeToken<List<Ability>>() {}.type
        return gson.toJson(value, type)
    }

    @TypeConverter
    fun toAbilityList(value: String): List<Ability>? {
        if (value.isEmpty()) return null
        val type = object : TypeToken<List<Ability>>() {}.type
        return gson.fromJson(value, type)
    }

    @TypeConverter
    fun fromAttackList(value: List<Attack>?): String {
        if (value == null) return ""
        val type = object : TypeToken<List<Attack>>() {}.type
        return gson.toJson(value, type)
    }

    @TypeConverter
    fun toAttackList(value: String): List<Attack>? {
        if (value.isEmpty()) return null
        val type = object : TypeToken<List<Attack>>() {}.type
        return gson.fromJson(value, type)
    }

    @TypeConverter
    fun fromWeaknessList(value: List<Weakness>?): String {
        if (value == null) return ""
        val type = object : TypeToken<List<Weakness>>() {}.type
        return gson.toJson(value, type)
    }

    @TypeConverter
    fun toWeaknessList(value: String): List<Weakness>? {
        if (value.isEmpty()) return null
        val type = object : TypeToken<List<Weakness>>() {}.type
        return gson.fromJson(value, type)
    }

    @TypeConverter
    fun fromIntList(value: List<Int>?): String {
        if (value == null) return ""
        val type = object : TypeToken<List<Int>>() {}.type
        return gson.toJson(value, type)
    }

    @TypeConverter
    fun toIntList(value: String): List<Int>? {
        if (value.isEmpty()) return null
        val type = object : TypeToken<List<Int>>() {}.type
        return gson.fromJson(value, type)
    }

    @TypeConverter
    fun fromLegalities(value: Legalities?): String {
        if (value == null) return ""
        val type = object : TypeToken<Legalities>() {}.type
        return gson.toJson(value, type)
    }

    @TypeConverter
    fun toLegalities(value: String): Legalities? {
        if (value.isEmpty()) return null
        val type = object : TypeToken<Legalities>() {}.type
        return gson.fromJson(value, type)
    }
}
